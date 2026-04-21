import json
import os
import boto3
import base64
import time
import uuid
import re
import pg8000
from datetime import datetime
from botocore.exceptions import ClientError

# ─────────────────────────────
# UTILITY FUNCTIONS
# ─────────────────────────────

# Global request origin - set at start of each request in handler()
_request_origin = None

def create_cors_response(status_code, body, origin=None, headers=None):
    global _request_origin
    # Use explicitly passed origin, or fall back to global request origin
    origin = origin or _request_origin

    # Load allowed origins from env var
    env_origins = os.environ.get('ALLOWED_ORIGINS', '[]')
    try:
        allowed_origins = json.loads(env_origins)
    except json.JSONDecodeError:
        allowed_origins = []
    if 'http://localhost:3000' not in allowed_origins:
        allowed_origins.append('http://localhost:3000')

    # Use the request origin if allowed (or if wildcard), otherwise fallback to localhost
    if '*' in allowed_origins:
        allow_origin = origin if origin else 'http://localhost:3000'
    elif origin and origin in allowed_origins:
        allow_origin = origin
    else:
        allow_origin = allowed_origins[0] if allowed_origins else 'http://localhost:3000'

    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allow_origin,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key,X-API-Key',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400'
    }
    if headers:
        cors_headers.update(headers)
    return {
        'statusCode': status_code,
        'headers': cors_headers,
        'body': json.dumps(body) if isinstance(body, dict) else body
    }

def get_database_connection():
    try:
        return pg8000.connect(
            host=os.environ["PGHOST"],
            port=int(os.getenv("PGPORT", 5432)),
            database=os.environ["PGDATABASE"],
            user=os.environ["PGUSER"],
            password=os.environ["PGPASSWORD"],
            ssl_context=True  # Enable SSL for RDS
        )
    except Exception as e:
        raise Exception(f"Database connection failed: {str(e)}")

# Database initialization flag
_db_initialized = False

def init_database():
    """Initialize database schema if needed"""
    global _db_initialized
    if _db_initialized:
        return

    try:
        conn = get_database_connection()
        cur = conn.cursor()

        # Create tables in order (respecting foreign key constraints)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                content_type TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS data_tables (
                id UUID PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS data_fields (
                id UUID PRIMARY KEY,
                table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                data_type TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS data_rows (
                id UUID PRIMARY KEY,
                table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
                data JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS data_field_mappings (
                id UUID PRIMARY KEY,
                table_id UUID REFERENCES data_tables(id) ON DELETE CASCADE,
                source_label TEXT NOT NULL,
                target_field TEXT NOT NULL,
                matcher TEXT NOT NULL DEFAULT 'contains',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS processing_jobs (
                id UUID PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                engine TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 0,
                result JSONB,
                confidence NUMERIC,
                error TEXT,
                target_table_id UUID REFERENCES data_tables(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ
            )
        """)

        # Create indexes
        cur.execute("CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS processing_jobs_user_idx ON processing_jobs(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS processing_jobs_status_idx ON processing_jobs(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS data_tables_user_idx ON data_tables(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS data_field_mappings_table_idx ON data_field_mappings(table_id)")

        conn.commit()
        cur.close()
        conn.close()
        _db_initialized = True
        print("Database schema initialized successfully")
    except Exception as e:
        print(f"Database initialization warning: {str(e)}")
        # Don't fail if schema already exists
        _db_initialized = True

def verify_cognito_token(token: str) -> dict:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            raise Exception("Invalid token format")
        payload = parts[1] + '=' * (4 - len(parts[1]) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        data = json.loads(decoded)

        if data.get('exp', 0) < time.time():
            raise Exception("Token expired")

        issuer = data.get('iss', '')
        expected_pool = os.getenv("COGNITO_USER_POOL_ID", "")
        if expected_pool not in issuer:
            raise Exception("Invalid token issuer")

        # Extract email from various possible locations in token
        email = data.get('email') or data.get('cognito:email') or data.get('preferred_username')
        username = data.get('cognito:username') or data.get('username') or data.get('sub')

        # If no email found, use username as email (common for username-based signups)
        if not email and username:
            # Check if username looks like an email
            if '@' in str(username):
                email = username
            else:
                # Generate a placeholder email using the sub
                email = f"{data.get('sub')}@docupop.local"

        display_name = (
            data.get('name')
            or data.get('given_name')
            or (email.split('@')[0] if email else None)
            or 'User'
        )

        return {
            "sub": data.get('sub'),
            "id": data.get('sub'),  # Alias for frontend compatibility
            "email": email,
            "username": username,
            "name": display_name
        }
    except Exception as e:
        raise Exception(f"Invalid token: {str(e)}")

def get_user_from_cognito(user_sub):
    """Fetch user details from Cognito if needed"""
    try:
        cognito = boto3.client('cognito-idp')
        user_pool_id = os.getenv("COGNITO_USER_POOL_ID", "")

        # List users with the sub filter
        response = cognito.list_users(
            UserPoolId=user_pool_id,
            Filter=f'sub = "{user_sub}"',
            Limit=1
        )

        if response.get('Users'):
            user = response['Users'][0]
            attrs = {attr['Name']: attr['Value'] for attr in user.get('Attributes', [])}
            return {
                'email': attrs.get('email', ''),
                'name': attrs.get('name', attrs.get('given_name', user.get('Username', ''))),
                'username': user.get('Username', '')
            }
    except Exception as e:
        print(f"Warning: Could not fetch user from Cognito: {e}")
    return None

def ensure_user_in_db(user_data):
    """Ensure user exists in PostgreSQL users table"""
    try:
        conn = get_database_connection()
        cur = conn.cursor()

        # Check if user exists
        cur.execute("SELECT id, email, name FROM users WHERE id = %s", (user_data['sub'],))
        existing = cur.fetchone()
        if not existing:
            email = user_data.get('email')
            name = user_data.get('name', 'User')

            # If email is still missing or is a placeholder, try to get from Cognito
            if not email or email.endswith('@docupop.local'):
                cognito_user = get_user_from_cognito(user_data['sub'])
                if cognito_user:
                    email = cognito_user.get('email') or email
                    name = cognito_user.get('name') or name

            # Final fallback - use sub-based email if still no email
            if not email:
                email = f"{user_data['sub']}@docupop.local"

            # Create user if doesn't exist
            print(f"Creating user in database: {user_data['sub']}, {email}, {name}")
            cur.execute(
                "INSERT INTO users (id, email, name, created_at) VALUES (%s, %s, %s, NOW()) ON CONFLICT (id) DO NOTHING",
                (user_data['sub'], email, name)
            )
            conn.commit()
            print(f"User created successfully: {user_data['sub']}")
        else:
            existing_email = existing[1]
            # If stored email is a placeholder, try to update with real email from Cognito
            if existing_email and existing_email.endswith('@docupop.local'):
                cognito_user = get_user_from_cognito(user_data['sub'])
                if cognito_user and cognito_user.get('email') and not cognito_user['email'].endswith('@docupop.local'):
                    new_email = cognito_user['email']
                    new_name = cognito_user.get('name') or existing[2]
                    cur.execute(
                        "UPDATE users SET email = %s, name = %s WHERE id = %s",
                        (new_email, new_name, user_data['sub'])
                    )
                    conn.commit()
                    print(f"Updated user email from placeholder to: {new_email}")
            else:
                print(f"User already exists: {user_data['sub']}")

        cur.close()
        conn.close()
    except Exception as e:
        import traceback
        print(f"WARNING ensuring user in database: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        # Don't raise - auth should still work even if DB sync fails

def get_current_user(event):
    headers = event.get('headers', {})
    auth_header = headers.get('Authorization') or headers.get('authorization')
    if not auth_header or not auth_header.startswith("Bearer "):
        raise Exception("Not authenticated")
    token = auth_header.split("Bearer ")[1]
    user_data = verify_cognito_token(token)

    # Ensure user exists in database (and fix placeholder emails)
    ensure_user_in_db(user_data)

    # Return DB record so real email/name are shown (not token-decoded placeholders)
    try:
        conn = get_database_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, email, name FROM users WHERE id = %s", (user_data['sub'],))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            user_data['email'] = row[1]
            user_data['name'] = row[2]
    except Exception as e:
        print(f"WARNING: Could not fetch user from DB: {e}")

    return user_data

def get_origin(event):
    """Extract origin from request headers for CORS"""
    headers = event.get('headers', {})
    return headers.get('origin') or headers.get('Origin')

def get_request_path(event):
    """Get the full request path with /api prefix"""
    raw_path = event.get("requestContext", {}).get("http", {}).get("path") or event.get("path", "")
    return raw_path if raw_path.startswith("/api") else f"/api{raw_path}"

def extract_id_from_path(event, segment_name="documents"):
    """Extract resource ID from path like /api/{segment_name}/{id} or /api/{segment_name}/{id}/action"""
    path = get_request_path(event)
    parts = [p for p in path.split("/") if p]  # filter empty strings
    # Find segment_name, then the next part is the ID
    for i, part in enumerate(parts):
        if part == segment_name and i + 1 < len(parts):
            candidate = parts[i + 1]
            if candidate not in ("download", "view", "import", "rows", "mappings", "fields"):
                return candidate
    return None

# ─────────────────────────────
# AUTH ROUTES
# ─────────────────────────────

def handle_health(event, context):
    try:
        # Initialize database schema on health check
        init_database()

        conn = get_database_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        result = cur.fetchone()
        cur.close()
        conn.close()

        return create_cors_response(200, {"status": "ok", "timestamp": datetime.now().isoformat()})
    except Exception as e:
        return create_cors_response(500, {"status": "unhealthy", "error": str(e)})

def handle_signup(event, context):
    """Cognito signup - creates user in Cognito"""
    origin = get_origin(event)
    try:
        data = json.loads(event.get("body", "{}"))
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")
        name = data.get("name", "")

        if not email or not password or not name:
            return create_cors_response(400, {"error": "Email, password, and name are required"}, origin=origin)

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # Check if user with this email already exists
        try:
            existing_users = cognito.list_users(
                UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
                Filter=f'email = "{email}"',
                Limit=1
            )
            if existing_users.get('Users'):
                return create_cors_response(400, {"error": "Email is already registered"}, origin=origin)
        except:
            pass  # Continue if check fails

        # Sign up user in Cognito
        # Use email as username (Cognito pool configured with username_attributes=["email"])
        username = email
        signup_response = cognito.sign_up(
            ClientId=os.environ["COGNITO_CLIENT_ID"],
            Username=username,
            Password=password,
            UserAttributes=[
                {'Name': 'email', 'Value': email},
                {'Name': 'name', 'Value': name}
            ]
        )

        user_sub = signup_response.get("UserSub")
        user_confirmed = signup_response.get("UserConfirmed", False)

        # Auto-confirm user if not already confirmed (for development)
        if not user_confirmed:
            try:
                cognito.admin_confirm_sign_up(
                    UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
                    Username=username
                )
                user_confirmed = True
            except:
                pass  # If admin confirm fails, continue

        # If user is confirmed, log them in and return token
        if user_confirmed:
            try:
                # Use the UUID username we just created for auto-login
                auth_response = cognito.admin_initiate_auth(
                    UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
                    ClientId=os.environ["COGNITO_CLIENT_ID"],
                    AuthFlow='ADMIN_USER_PASSWORD_AUTH',
                    AuthParameters={
                        'USERNAME': username,  # Use UUID username, not email
                        'PASSWORD': password
                    }
                )

                if auth_response.get('AuthenticationResult'):
                    access_token = auth_response['AuthenticationResult']['AccessToken']
                    return create_cors_response(200, {
                        "user": {
                            "id": user_sub,
                            "email": email,
                            "name": name
                        },
                        "token": access_token,
                        "confirmationRequired": False
                    }, origin=origin)
            except:
                pass  # If login fails, just return without token

        return create_cors_response(200, {
            "user": {
                "id": user_sub,
                "email": email,
                "name": name
            },
            "confirmationRequired": not user_confirmed
        }, origin=origin)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']

        if error_code == 'UsernameExistsException':
            return create_cors_response(400, {"error": "Email is already registered"}, origin=origin)
        elif error_code == 'InvalidPasswordException':
            return create_cors_response(400, {"error": "Password does not meet requirements"}, origin=origin)
        elif error_code == 'InvalidParameterException':
            return create_cors_response(400, {"error": f"Signup failed: {error_msg}"}, origin=origin)
        else:
            return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        return create_cors_response(500, {"error": str(e)}, origin=origin)

def handle_login(event, context):
    """Cognito login"""
    origin = get_origin(event)
    try:
        data = json.loads(event.get("body", "{}"))
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return create_cors_response(400, {"error": "Email and password are required"}, origin=origin)

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # Look up actual username from email (email is an alias, not the username)
        try:
            users = cognito.list_users(
                UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
                Filter=f'email = "{email}"'
            )

            if not users.get('Users'):
                return create_cors_response(400, {"error": "Invalid email or password", "debug": "No user found with this email"}, origin=origin)

            # Use most recent user if multiple exist (sort by UserCreateDate descending)
            sorted_users = sorted(users['Users'], key=lambda u: u['UserCreateDate'], reverse=True)
            actual_username = sorted_users[0]['Username']
        except Exception as e:
            print(f"Error looking up user by email: {str(e)}")
            return create_cors_response(400, {"error": "Invalid email or password", "debug": f"Lookup error: {str(e)}"}, origin=origin)

        # Use admin auth with actual UUID username
        response = cognito.admin_initiate_auth(
            UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
            ClientId=os.environ["COGNITO_CLIENT_ID"],
            AuthFlow='ADMIN_USER_PASSWORD_AUTH',
            AuthParameters={
                'USERNAME': actual_username,
                'PASSWORD': password
            }
        )

        # Check if MFA is required
        if response.get('ChallengeName') == 'SOFTWARE_TOKEN_MFA':
            return create_cors_response(200, {
                "mfaRequired": True,
                "session": response.get('Session'),
                "email": email
            }, origin=origin)

        # Check if MFA setup is required (first time)
        if response.get('ChallengeName') == 'MFA_SETUP':
            return create_cors_response(200, {
                "mfaSetupRequired": True,
                "session": response.get('Session'),
                "email": email
            }, origin=origin)

        if not response.get('AuthenticationResult'):
            return create_cors_response(400, {"error": "Authentication failed"}, origin=origin)

        access_token = response['AuthenticationResult']['AccessToken']

        # Get user details
        user_response = cognito.get_user(AccessToken=access_token)

        attributes = {attr['Name']: attr['Value'] for attr in user_response.get('UserAttributes', [])}

        return create_cors_response(200, {
            "user": {
                "id": attributes.get('sub'),
                "email": attributes.get('email'),
                "name": attributes.get('name', 'User')
            },
            "token": access_token
        }, origin=origin)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']

        if error_code in ['NotAuthorizedException', 'UserNotFoundException']:
            return create_cors_response(400, {"error": "Invalid email or password", "debug": error_msg}, origin=origin)
        elif error_code == 'UserNotConfirmedException':
            return create_cors_response(400, {"error": "Email not confirmed. Please check your email."}, origin=origin)
        else:
            return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        return create_cors_response(500, {"error": str(e)}, origin=origin)

def handle_auth_me(event, context):
    """Get current user info"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        return create_cors_response(200, {"user": user}, origin=origin)
    except Exception as e:
        return create_cors_response(401, {"error": str(e)}, origin=origin)

def handle_logout(event, context):
    """Logout - client-side only"""
    origin = get_origin(event)
    return create_cors_response(200, {"success": True}, origin=origin)

def handle_mfa_verify(event, context):
    """Verify MFA code during login"""
    origin = get_origin(event)
    try:
        data = json.loads(event.get("body", "{}"))
        session = data.get("session")
        mfa_code = data.get("mfaCode", "")
        email = data.get("email", "").strip().lower()

        if not session or not mfa_code or not email:
            return create_cors_response(400, {"error": "Session, MFA code, and email are required"}, origin=origin)

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # Look up actual username from email
        users = cognito.list_users(
            UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
            Filter=f'email = "{email}"'
        )

        if not users.get('Users'):
            return create_cors_response(400, {"error": "User not found"}, origin=origin)

        sorted_users = sorted(users['Users'], key=lambda u: u['UserCreateDate'], reverse=True)
        actual_username = sorted_users[0]['Username']

        # Respond to MFA challenge
        response = cognito.admin_respond_to_auth_challenge(
            UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
            ClientId=os.environ["COGNITO_CLIENT_ID"],
            ChallengeName='SOFTWARE_TOKEN_MFA',
            Session=session,
            ChallengeResponses={
                'USERNAME': actual_username,
                'SOFTWARE_TOKEN_MFA_CODE': mfa_code
            }
        )

        if not response.get('AuthenticationResult'):
            return create_cors_response(400, {"error": "MFA verification failed"}, origin=origin)

        access_token = response['AuthenticationResult']['AccessToken']

        # Get user details
        user_response = cognito.get_user(AccessToken=access_token)
        attributes = {attr['Name']: attr['Value'] for attr in user_response.get('UserAttributes', [])}

        return create_cors_response(200, {
            "user": {
                "id": attributes.get('sub'),
                "email": attributes.get('email'),
                "name": attributes.get('name', 'User')
            },
            "accessToken": access_token
        }, origin=origin)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']

        if error_code == 'CodeMismatchException':
            return create_cors_response(400, {"error": "Invalid MFA code. Please try again."}, origin=origin)
        elif error_code == 'ExpiredCodeException':
            return create_cors_response(401, {"error": "Session expired. Please login again."}, origin=origin)
        else:
            return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        return create_cors_response(500, {"error": str(e)}, origin=origin)

def handle_mfa_setup_get(event, context):
    """Get TOTP secret for MFA setup"""
    origin = get_origin(event)
    try:
        # Get session from query params
        query_params = event.get('queryStringParameters') or {}
        session = query_params.get('session')

        if not session:
            return create_cors_response(400, {"error": "Session is required"}, origin=origin)

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # Associate TOTP software token
        response = cognito.associate_software_token(Session=session)

        secret_code = response.get('SecretCode')
        new_session = response.get('Session')

        # Generate otpauth URI for QR code
        issuer = 'DocuPop'
        otpauth_uri = f'otpauth://totp/{issuer}?secret={secret_code}&issuer={issuer}'

        return create_cors_response(200, {
            "secretCode": secret_code,
            "session": new_session,
            "otpauthUri": otpauth_uri
        }, origin=origin)

    except ClientError as e:
        error_msg = e.response['Error']['Message']
        return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        return create_cors_response(500, {"error": str(e)}, origin=origin)

def handle_mfa_setup_post(event, context):
    """Complete MFA setup by verifying the first TOTP code"""
    origin = get_origin(event)
    try:
        data = json.loads(event.get("body", "{}"))
        session = data.get("session")
        mfa_code = data.get("mfaCode", "")
        email = data.get("email", "").strip().lower()

        if not session or not mfa_code or not email:
            return create_cors_response(400, {"error": "Session, MFA code, and email are required"}, origin=origin)

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # Verify the software token
        verify_response = cognito.verify_software_token(
            Session=session,
            UserCode=mfa_code
        )

        if verify_response.get('Status') != 'SUCCESS':
            return create_cors_response(400, {"error": "Invalid MFA code"}, origin=origin)

        new_session = verify_response.get('Session')

        # Look up actual username from email
        users = cognito.list_users(
            UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
            Filter=f'email = "{email}"'
        )

        if not users.get('Users'):
            return create_cors_response(400, {"error": "User not found"}, origin=origin)

        sorted_users = sorted(users['Users'], key=lambda u: u['UserCreateDate'], reverse=True)
        actual_username = sorted_users[0]['Username']

        # Respond to MFA_SETUP challenge to complete authentication
        auth_response = cognito.admin_respond_to_auth_challenge(
            UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
            ClientId=os.environ["COGNITO_CLIENT_ID"],
            ChallengeName='MFA_SETUP',
            Session=new_session,
            ChallengeResponses={
                'USERNAME': actual_username
            }
        )

        if not auth_response.get('AuthenticationResult'):
            return create_cors_response(400, {"error": "MFA setup failed"}, origin=origin)

        access_token = auth_response['AuthenticationResult']['AccessToken']

        # Get user details
        user_response = cognito.get_user(AccessToken=access_token)
        attributes = {attr['Name']: attr['Value'] for attr in user_response.get('UserAttributes', [])}

        return create_cors_response(200, {
            "user": {
                "id": attributes.get('sub'),
                "email": attributes.get('email'),
                "name": attributes.get('name', 'User')
            },
            "accessToken": access_token,
            "message": "MFA setup completed successfully"
        }, origin=origin)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']

        if error_code in ['CodeMismatchException', 'EnableSoftwareTokenMFAException']:
            return create_cors_response(400, {"error": "Invalid MFA code. Please try again."}, origin=origin)
        else:
            return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        return create_cors_response(500, {"error": str(e)}, origin=origin)

def handle_mfa_status(event, context):
    """Get MFA status for the current user"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # Get user's MFA settings from Cognito
        # First, look up the user by their sub
        users = cognito.list_users(
            UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
            Filter=f'sub = "{user["sub"]}"',
            Limit=1
        )

        if not users.get('Users'):
            return create_cors_response(404, {"error": "User not found"}, origin=origin)

        cognito_user = users['Users'][0]

        # Check if TOTP MFA is enabled by looking at MFAOptions or UserMFASettingList
        mfa_enabled = False
        preferred_mfa = None

        # Get detailed user info using admin_get_user
        user_details = cognito.admin_get_user(
            UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
            Username=cognito_user['Username']
        )

        # Check UserMFASettingList for enabled MFA methods
        mfa_settings = user_details.get('UserMFASettingList', [])
        if 'SOFTWARE_TOKEN_MFA' in mfa_settings:
            mfa_enabled = True
            preferred_mfa = 'TOTP'

        # Also check PreferredMfaSetting
        if user_details.get('PreferredMfaSetting') == 'SOFTWARE_TOKEN_MFA':
            mfa_enabled = True
            preferred_mfa = 'TOTP'

        return create_cors_response(200, {
            "mfaEnabled": mfa_enabled,
            "preferredMfa": preferred_mfa,
            "availableMethods": ["TOTP"] if mfa_enabled else []
        }, origin=origin)

    except ClientError as e:
        error_msg = e.response['Error']['Message']
        return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)}, origin=origin)
        return create_cors_response(500, {"error": str(e)}, origin=origin)

def handle_mfa_enable_get(event, context):
    """Get TOTP secret for enabling MFA on an existing account"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)

        # Get the access token from the Authorization header
        headers = event.get('headers', {})
        auth_header = headers.get('Authorization') or headers.get('authorization')
        access_token = auth_header.split("Bearer ")[1]

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # Associate a software token with the user's account
        response = cognito.associate_software_token(AccessToken=access_token)

        secret_code = response.get('SecretCode')

        # Generate otpauth URI for QR code
        issuer = 'DocuPop'
        email = user.get('email', 'user')
        otpauth_uri = f'otpauth://totp/{issuer}:{email}?secret={secret_code}&issuer={issuer}'

        return create_cors_response(200, {
            "secretCode": secret_code,
            "otpauthUri": otpauth_uri
        }, origin=origin)

    except ClientError as e:
        error_msg = e.response['Error']['Message']
        return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)}, origin=origin)
        return create_cors_response(500, {"error": str(e)}, origin=origin)

def handle_mfa_enable_post(event, context):
    """Verify TOTP code and enable MFA on user's account"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        data = json.loads(event.get("body", "{}"))
        mfa_code = data.get("mfaCode", "")

        if not mfa_code:
            return create_cors_response(400, {"error": "MFA code is required"}, origin=origin)

        # Get the access token from the Authorization header
        headers = event.get('headers', {})
        auth_header = headers.get('Authorization') or headers.get('authorization')
        access_token = auth_header.split("Bearer ")[1]

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # Verify the TOTP code
        verify_response = cognito.verify_software_token(
            AccessToken=access_token,
            UserCode=mfa_code,
            FriendlyDeviceName='Authenticator App'
        )

        if verify_response.get('Status') != 'SUCCESS':
            return create_cors_response(400, {"error": "Invalid MFA code"}, origin=origin)

        # Enable TOTP MFA for the user
        cognito.set_user_mfa_preference(
            AccessToken=access_token,
            SoftwareTokenMfaSettings={
                'Enabled': True,
                'PreferredMfa': True
            }
        )

        return create_cors_response(200, {
            "success": True,
            "message": "MFA enabled successfully"
        }, origin=origin)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']

        if error_code in ['CodeMismatchException', 'EnableSoftwareTokenMFAException']:
            return create_cors_response(400, {"error": "Invalid MFA code. Please try again."}, origin=origin)
        else:
            return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)}, origin=origin)
        return create_cors_response(500, {"error": str(e)}, origin=origin)

def handle_mfa_disable(event, context):
    """Disable MFA on user's account"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        data = json.loads(event.get("body", "{}"))
        mfa_code = data.get("mfaCode", "")

        if not mfa_code:
            return create_cors_response(400, {"error": "MFA code is required to disable MFA"}, origin=origin)

        # Get the access token from the Authorization header
        headers = event.get('headers', {})
        auth_header = headers.get('Authorization') or headers.get('authorization')
        access_token = auth_header.split("Bearer ")[1]

        cognito = boto3.client('cognito-idp', region_name=os.getenv("AWS_DEFAULT_REGION", "us-west-1"))

        # First verify the MFA code to ensure user has valid authenticator
        # We'll use admin APIs to verify since user already has MFA enabled
        users = cognito.list_users(
            UserPoolId=os.environ["COGNITO_USER_POOL_ID"],
            Filter=f'sub = "{user["sub"]}"',
            Limit=1
        )

        if not users.get('Users'):
            return create_cors_response(404, {"error": "User not found"}, origin=origin)

        actual_username = users['Users'][0]['Username']

        # Verify the current TOTP code by attempting an auth challenge
        # This ensures the user has access to their authenticator before disabling
        try:
            # Verify the code is valid by using verify_software_token
            # Note: This may fail if the token was already verified, so we catch that
            cognito.verify_software_token(
                AccessToken=access_token,
                UserCode=mfa_code
            )
        except ClientError as verify_error:
            # If code mismatch, reject the request
            if verify_error.response['Error']['Code'] == 'CodeMismatchException':
                return create_cors_response(400, {"error": "Invalid MFA code"}, origin=origin)
            # Other errors might be OK (e.g., token already verified)
            pass

        # Disable TOTP MFA for the user
        cognito.set_user_mfa_preference(
            AccessToken=access_token,
            SoftwareTokenMfaSettings={
                'Enabled': False,
                'PreferredMfa': False
            }
        )

        return create_cors_response(200, {
            "success": True,
            "message": "MFA disabled successfully"
        }, origin=origin)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_msg = e.response['Error']['Message']

        if error_code == 'CodeMismatchException':
            return create_cors_response(400, {"error": "Invalid MFA code"}, origin=origin)
        else:
            return create_cors_response(400, {"error": error_msg}, origin=origin)
    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)}, origin=origin)
        return create_cors_response(500, {"error": str(e)}, origin=origin)

# ─────────────────────────────
# DOCUMENT ROUTES
# ─────────────────────────────

def handle_list_documents(event, context):
    try:
        user = get_current_user(event)
        conn = get_database_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, filename, stored_filename, file_size, content_type, created_at
            FROM documents WHERE user_id = %s ORDER BY created_at DESC
        """, (user["sub"],))
        rows = cur.fetchall()

        docs = [
            {
                "id": r[0],
                "filename": r[1],
                "file_size": r[3],
                "content_type": r[4],
                "created_at": r[5].isoformat() if r[5] else None
            } for r in rows
        ]
        cur.close()
        conn.close()
        return create_cors_response(200, {"documents": docs})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_upload_document(event, context):
    """Upload document to S3 and save metadata"""
    try:
        user = get_current_user(event)
        data = json.loads(event.get("body", "{}"))

        filename = data.get("filename", "")
        content = data.get("content", "")  # base64 encoded
        content_type = data.get("contentType", "")

        if not filename or not content:
            return create_cors_response(400, {"error": "Filename and content are required"})

        # Decode base64 content
        file_data = base64.b64decode(content)
        file_size = len(file_data)

        # Generate S3 key
        timestamp = int(time.time())
        stored_filename = f"{uuid.uuid4().hex}_{timestamp}_{filename}"
        s3_key = f"uploads/{user['sub']}/{stored_filename}"

        # Upload to S3
        s3 = boto3.client("s3")
        bucket = os.environ["S3_BUCKET_NAME"]
        s3.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=file_data,
            ContentType=content_type,
            Metadata={
                "user_id": user["sub"],
                "original_filename": filename
            }
        )

        # Save to database
        conn = get_database_connection()
        cur = conn.cursor()

        cur.execute("""
            INSERT INTO documents (user_id, filename, stored_filename, file_size, content_type, created_at)
            VALUES (%s, %s, %s, %s, %s, NOW()) RETURNING id
        """, (user["sub"], filename, stored_filename, file_size, content_type))
        doc_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()

        return create_cors_response(200, {
            "document": {
                "id": doc_id,
                "filename": filename,
                "file_size": file_size,
                "content_type": content_type
            }
        })

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_get_document(event, context):
    """Get document details"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        doc_id = extract_id_from_path(event, "documents")
        if not doc_id or not doc_id.isdigit():
            return create_cors_response(400, {"error": "Missing or invalid document ID"}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, filename, stored_filename, file_size, content_type, created_at
            FROM documents WHERE id = %s AND user_id = %s
        """, (int(doc_id), user["sub"]))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Document not found"})

        cur.close()
        conn.close()
        return create_cors_response(200, {
            "document": {
                "id": row[0],
                "filename": row[1],
                "file_size": row[3],
                "content_type": row[4],
                "created_at": row[5].isoformat() if row[5] else None
            }
        })

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_delete_document(event, context):
    """Delete document"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        doc_id = extract_id_from_path(event, "documents")
        if not doc_id or not doc_id.isdigit():
            return create_cors_response(400, {"error": "Missing or invalid document ID"}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Get stored filename for S3 deletion
        cur.execute("""
            SELECT stored_filename FROM documents WHERE id = %s AND user_id = %s
        """, (int(doc_id), user["sub"]))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Document not found"})

        stored_filename = row[0]

        # Delete from S3
        s3_key = f"uploads/{user['sub']}/{stored_filename}"
        s3 = boto3.client("s3")
        bucket = os.environ["S3_BUCKET_NAME"]
        try:
            s3.delete_object(Bucket=bucket, Key=s3_key)
        except:
            pass  # Continue even if S3 delete fails

        # Delete from database
        cur.execute("DELETE FROM documents WHERE id = %s AND user_id = %s", (int(doc_id), user["sub"]))
        conn.commit()
        cur.close()
        conn.close()

        return create_cors_response(200, {"success": True})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_download_document(event, context):
    """Generate signed URL to download document"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        doc_id = extract_id_from_path(event, "documents")
        # Validate doc_id is numeric
        if not doc_id or doc_id == "download" or not doc_id.isdigit():
            print(f"Invalid document ID for download: path={path}, parts={path_parts}, doc_id={doc_id}")
            return create_cors_response(400, {"error": "Missing or invalid document ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Get document info
        cur.execute("""
            SELECT stored_filename, filename, content_type FROM documents WHERE id = %s AND user_id = %s
        """, (int(doc_id), user["sub"]))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Document not found"})

        stored_filename, original_filename, content_type = row
        cur.close()
        conn.close()

        # Generate signed URL for download
        s3 = boto3.client("s3")
        bucket = os.environ["S3_BUCKET_NAME"]
        s3_key = f"uploads/{user['sub']}/{stored_filename}"

        signed_url = s3.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': bucket,
                'Key': s3_key,
                'ResponseContentDisposition': f'attachment; filename="{original_filename}"',
                'ResponseContentType': content_type
            },
            ExpiresIn=3600  # 1 hour
        )

        # Return signed URL as JSON
        return create_cors_response(200, {"url": signed_url})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_view_document(event, context):
    """Generate signed URL to view document in browser"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        doc_id = extract_id_from_path(event, "documents")
        if not doc_id or not doc_id.isdigit():
            return create_cors_response(400, {"error": "Missing or invalid document ID"}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Get document info
        cur.execute("""
            SELECT stored_filename, content_type FROM documents WHERE id = %s AND user_id = %s
        """, (int(doc_id), user["sub"]))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Document not found"})

        stored_filename, content_type = row
        cur.close()
        conn.close()

        # Generate signed URL for viewing
        s3 = boto3.client("s3")
        bucket = os.environ["S3_BUCKET_NAME"]
        s3_key = f"uploads/{user['sub']}/{stored_filename}"

        signed_url = s3.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': bucket,
                'Key': s3_key,
                'ResponseContentType': content_type
            },
            ExpiresIn=3600  # 1 hour
        )

        # Return signed URL as JSON
        return create_cors_response(200, {"url": signed_url})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

# ─────────────────────────────
# DATA TABLES ROUTES
# ─────────────────────────────

def handle_list_tables(event, context):
    """List all data tables for user"""
    try:
        user = get_current_user(event)
        conn = get_database_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, name, description, created_at
            FROM data_tables WHERE user_id = %s ORDER BY created_at DESC
        """, (user["sub"],))
        rows = cur.fetchall()

        tables = []
        for r in rows:
            table_id = r[0]
            # Get fields for this table
            cur.execute("""
                SELECT id, name, data_type, position
                FROM data_fields WHERE table_id = %s ORDER BY position
            """, (table_id,))
            fields = [{"id": str(f[0]), "name": f[1], "data_type": f[2], "position": f[3]} for f in cur.fetchall()]

            tables.append({
                "id": str(table_id),
                "name": r[1],
                "description": r[2],
                "created_at": r[3].isoformat() if r[3] else None,
                "fields": fields
            })

        cur.close()
        conn.close()
        return create_cors_response(200, {"tables": tables})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_create_table(event, context):
    """Create a new data table"""
    try:
        user = get_current_user(event)
        data = json.loads(event.get("body", "{}"))

        name = data.get("name", "")
        description = data.get("description", "")
        fields = data.get("fields", [])

        if not name:
            return create_cors_response(400, {"error": "Table name is required"})

        conn = get_database_connection()
        cur = conn.cursor()

        # Create table
        table_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO data_tables (id, user_id, name, description, created_at)
            VALUES (%s, %s, %s, %s, NOW())
        """, (table_id, user["sub"], name, description))

        # Create fields
        created_fields = []
        for i, field in enumerate(fields):
            field_id = str(uuid.uuid4())
            field_name = field.get("name", "")
            data_type = field.get("data_type", "text")
            cur.execute("""
                INSERT INTO data_fields (id, table_id, name, data_type, position)
                VALUES (%s, %s, %s, %s, %s)
            """, (field_id, table_id, field_name, data_type, i))
            created_fields.append({"id": str(field_id), "name": field_name, "data_type": data_type, "position": i})

        conn.commit()
        cur.close()
        conn.close()

        return create_cors_response(200, {
            "table": {
                "id": str(table_id),
                "name": name,
                "description": description,
                "fields": created_fields,
                "created_at": datetime.now().isoformat()
            }
        })

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_add_field(event, context):
    """Add a new field column to a table"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        path_parts = path.split("/")
        # Path: /api/data/tables/{id}/fields
        table_id = path_parts[4] if len(path_parts) > 4 else None

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        data = json.loads(event.get("body", "{}"))
        field_name = data.get("name", "").strip()
        data_type = data.get("data_type", "text")

        if not field_name:
            return create_cors_response(400, {"error": "Field name is required"}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        # Check if field already exists
        cur.execute("SELECT id FROM data_fields WHERE table_id = %s AND name = %s", (table_id, field_name))
        if cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(400, {"error": f"Field '{field_name}' already exists"}, origin=origin)

        # Get the next position
        cur.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM data_fields WHERE table_id = %s", (table_id,))
        next_position = cur.fetchone()[0]

        # Insert the new field
        field_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO data_fields (id, table_id, name, data_type, position)
            VALUES (%s, %s, %s, %s, %s)
        """, (field_id, table_id, field_name, data_type, next_position))
        conn.commit()
        cur.close()
        conn.close()

        return create_cors_response(200, {
            "field": {
                "id": field_id,
                "table_id": table_id,
                "name": field_name,
                "data_type": data_type,
                "position": next_position
            }
        }, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})


def handle_import_csv(event, context):
    """Import CSV data into a table, creating columns from headers"""
    import csv
    import io
    import base64

    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        path_parts = path.split("/")
        # Path: /api/data/tables/{id}/import
        table_id = path_parts[4] if len(path_parts) > 4 else None

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        # Parse multipart form data to get the file
        content_type = event.get('headers', {}).get('content-type', '') or event.get('headers', {}).get('Content-Type', '')
        body = event.get('body', '')
        is_base64 = event.get('isBase64Encoded', False)

        if is_base64:
            body = base64.b64decode(body).decode('utf-8', errors='replace')

        # Extract CSV content from multipart form data
        csv_content = None
        if 'multipart/form-data' in content_type:
            # Parse boundary
            boundary = None
            for part in content_type.split(';'):
                part = part.strip()
                if part.startswith('boundary='):
                    boundary = part[9:].strip('"')
                    break

            if boundary:
                parts = body.split('--' + boundary)
                for part in parts:
                    if 'filename=' in part and '.csv' in part.lower():
                        # Find the content after the headers
                        header_end = part.find('\r\n\r\n')
                        if header_end == -1:
                            header_end = part.find('\n\n')
                        if header_end != -1:
                            csv_content = part[header_end:].strip()
                            # Remove trailing boundary markers
                            if csv_content.endswith('--'):
                                csv_content = csv_content[:-2].strip()
                            break

        if not csv_content:
            return create_cors_response(400, {"error": "No CSV file found in request"}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership
        cur.execute("SELECT id, name FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        table_row = cur.fetchone()
        if not table_row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        # Parse CSV
        csv_reader = csv.DictReader(io.StringIO(csv_content))
        headers = csv_reader.fieldnames or []

        if not headers:
            cur.close()
            conn.close()
            return create_cors_response(400, {"error": "CSV file has no headers"}, origin=origin)

        # Get existing fields for this table
        cur.execute("SELECT name FROM data_fields WHERE table_id = %s", (table_id,))
        existing_fields = {row[0] for row in cur.fetchall()}

        # Get the next position for new fields
        cur.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM data_fields WHERE table_id = %s", (table_id,))
        next_position = cur.fetchone()[0]

        # Create fields for any new headers
        new_fields = []
        for header in headers:
            header = header.strip()
            if header and header not in existing_fields:
                field_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO data_fields (id, table_id, name, data_type, position)
                    VALUES (%s, %s, %s, 'text', %s)
                """, (field_id, table_id, header, next_position))
                new_fields.append(header)
                next_position += 1
                print(f"Created new field: {header}")

        # Insert rows from CSV
        inserted_count = 0
        for row in csv_reader:
            # Build data object with value/confidence structure
            row_data = {}
            for header in headers:
                header = header.strip()
                if header:
                    value = row.get(header, '') or ''
                    row_data[header] = {
                        'value': value.strip() if isinstance(value, str) else value,
                        'confidence': None
                    }

            if row_data:
                row_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO data_rows (id, table_id, data, created_at, updated_at)
                    VALUES (%s, %s, %s, NOW(), NOW())
                """, (row_id, table_id, json.dumps(row_data)))
                inserted_count += 1

        conn.commit()
        cur.close()
        conn.close()

        return create_cors_response(200, {
            "inserted": inserted_count,
            "new_fields": new_fields,
            "message": f"Imported {inserted_count} rows" + (f" and created {len(new_fields)} new fields" if new_fields else "")
        }, origin=origin)

    except Exception as e:
        print(f"CSV import error: {str(e)}")
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})


# ─────────────────────────────
# PROCESSING ROUTES
# ─────────────────────────────

def handle_list_processing_jobs(event, context):
    """List processing jobs for user"""
    try:
        user = get_current_user(event)
        conn = get_database_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT pj.id, pj.document_id, pj.status, pj.engine, pj.created_at, pj.completed_at,
                   pj.result, pj.confidence, pj.error, pj.target_table_id, dt.name as table_name
            FROM processing_jobs pj
            LEFT JOIN data_tables dt ON pj.target_table_id = dt.id
            WHERE pj.user_id = %s ORDER BY pj.created_at DESC
        """, (user["sub"],))
        rows = cur.fetchall()

        jobs = []
        for r in rows:
            job = {
                "id": str(r[0]),
                "document_id": r[1],
                "status": r[2],
                "engine": r[3],
                "created_at": r[4].isoformat() if r[4] else None,
                "completed_at": r[5].isoformat() if r[5] else None,
                "result": r[6],
                "confidence": float(r[7]) if r[7] is not None else None,
                "error": r[8],
                "target_table_id": str(r[9]) if r[9] else None,
            }
            if r[10]:  # table_name
                job["target_table"] = {"id": str(r[9]), "name": r[10]}
            jobs.append(job)

        cur.close()
        conn.close()
        return create_cors_response(200, {"jobs": jobs})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_delete_processing_job(event, context):
    """Delete/cancel a processing job"""
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        # Extract job ID from path: /api/processing/{job_id}
        parts = path.split("/")
        job_id = parts[-1] if len(parts) > 0 else None

        if not job_id:
            return create_cors_response(400, {"error": "Missing job ID"})

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify job belongs to user and get status
        cur.execute("""
            SELECT status FROM processing_jobs WHERE id = %s AND user_id = %s
        """, (job_id, user["sub"]))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Job not found"})

        # Delete the job
        cur.execute("DELETE FROM processing_jobs WHERE id = %s AND user_id = %s", (job_id, user["sub"]))
        conn.commit()
        cur.close()
        conn.close()

        return create_cors_response(200, {"success": True, "message": "Job deleted"})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_list_textract_adapters(event, context):
    """List available Textract custom adapters and their versions"""
    try:
        user = get_current_user(event)
        textract_client = boto3.client('textract')

        # List all adapters
        adapters_response = textract_client.list_adapters()
        adapters = []

        for adapter in adapters_response.get('Adapters', []):
            adapter_id = adapter.get('AdapterId')
            adapter_name = adapter.get('AdapterName', 'Unnamed')
            feature_types = adapter.get('FeatureTypes', [])

            # Get versions for this adapter
            versions_response = textract_client.list_adapter_versions(AdapterId=adapter_id)
            versions = []

            for version in versions_response.get('AdapterVersions', []):
                version_info = {
                    'version': version.get('AdapterVersion'),  # AWS returns AdapterVersion, not Version
                    'status': version.get('Status'),
                    'createdAt': version.get('CreationTime').isoformat() if version.get('CreationTime') else None,
                }
                # Only include active versions
                if version.get('Status') == 'ACTIVE':
                    versions.append(version_info)

            adapters.append({
                'id': adapter_id,
                'name': adapter_name,
                'featureTypes': feature_types,
                'versions': versions,
            })

        return create_cors_response(200, {"adapters": adapters})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        print(f"Error listing adapters: {str(e)}")
        return create_cors_response(500, {"error": str(e)})

def handle_queue_processing_jobs(event, context):
    """Queue OCR processing jobs to SQS for Textract processing"""
    try:
        user = get_current_user(event)
        raw_body = event.get("body", "{}")
        print(f"[DEBUG] Queue jobs body: {raw_body}")
        data = json.loads(raw_body) if raw_body else {}
        document_ids = data.get("documentIds", [])
        print(f"[DEBUG] document_ids={document_ids}, SQS_ENABLED={os.environ.get('SQS_ENABLED')}, SQS_URL={os.environ.get('SQS_QUEUE_URL')}")
        engine = data.get("engine", "textract")  # Default to textract
        target_table_id = data.get("targetTableId")
        # Optional: Custom Textract queries for targeted field extraction
        # Format: [{text: "What is the invoice number?", alias: "InvoiceNumber"}, ...]
        queries = data.get("queries")
        # Optional: Custom adapter for specialized document types
        adapter_id = data.get("adapterId")
        adapter_version = data.get("adapterVersion")

        # Look up adapter feature types if adapter is specified
        adapter_feature_types = None
        if adapter_id:
            print(f"[INFO] Looking up adapter feature types for: {adapter_id}")
            try:
                textract_client = boto3.client('textract')
                adapter_info = textract_client.get_adapter(AdapterId=adapter_id)
                adapter_feature_types = adapter_info.get('FeatureTypes', [])
                print(f"[INFO] Adapter {adapter_id} feature types: {adapter_feature_types}")
            except Exception as adapter_err:
                print(f"[ERROR] Failed to get adapter info: {adapter_err}")

        conn = get_database_connection()
        cur = conn.cursor()
        jobs = []

        # Get SQS queue URL from environment
        sqs_queue_url = os.environ.get("SQS_QUEUE_URL")
        sqs_enabled = os.environ.get("SQS_ENABLED", "false").lower() == "true"

        # Initialize SQS client
        sqs_client = boto3.client('sqs') if sqs_enabled and sqs_queue_url else None

        for doc_id in document_ids:
            job_id = str(uuid.uuid4())

            # Get document details for the SQS message
            cur.execute("""
                SELECT id, stored_filename, filename, content_type
                FROM documents WHERE id = %s AND user_id = %s
            """, (doc_id, user["sub"]))
            doc_row = cur.fetchone()

            if not doc_row:
                print(f"Document {doc_id} not found for user {user['sub']}")
                continue

            stored_filename = doc_row[1]
            filename = doc_row[2]
            content_type = doc_row[3]

            # Insert job into database
            cur.execute("""
                INSERT INTO processing_jobs (id, user_id, document_id, status, engine, priority, target_table_id, created_at, updated_at)
                VALUES (%s, %s, %s, 'pending', %s, 0, %s, NOW(), NOW())
            """, (job_id, user["sub"], doc_id, engine, target_table_id))

            # Send message to SQS for async processing
            if sqs_client:
                # Build full S3 key with user path prefix
                s3_key = f"uploads/{user['sub']}/{stored_filename}"
                sqs_message = {
                    "jobId": job_id,
                    "documentId": doc_id,
                    "userId": user["sub"],
                    "targetTableId": target_table_id,
                    "storageKey": s3_key,
                    "filename": filename,
                    "contentType": content_type
                }
                # Add optional query/adapter config for enhanced Textract processing
                if queries:
                    sqs_message["queries"] = queries
                if adapter_id:
                    sqs_message["adapterId"] = adapter_id
                if adapter_version:
                    sqs_message["adapterVersion"] = adapter_version
                if adapter_feature_types:
                    sqs_message["adapterFeatureTypes"] = adapter_feature_types

                print(f"[INFO] SQS message for job {job_id}: adapterId={adapter_id}, adapterVersion={adapter_version}, adapterFeatureTypes={adapter_feature_types}")

                try:
                    send_params = {
                        'QueueUrl': sqs_queue_url,
                        'MessageBody': json.dumps(sqs_message),
                    }
                    # Only add FIFO parameters for FIFO queues
                    if ".fifo" in sqs_queue_url:
                        send_params['MessageGroupId'] = user["sub"]
                        send_params['MessageDeduplicationId'] = job_id

                    print(f"[DEBUG] Calling sqs_client.send_message for job {job_id}")
                    response = sqs_client.send_message(**send_params)
                    print(f"[DEBUG] SQS send response: {response.get('MessageId', 'no-id')}")
                    print(f"Queued job {job_id} to SQS for document {filename}")
                except Exception as sqs_error:
                    import traceback
                    print(f"[ERROR] Failed to send SQS message for job {job_id}: {sqs_error}")
                    print(f"[ERROR] Traceback: {traceback.format_exc()}")
                    # Job is still in DB as pending, could be retried manually

            jobs.append({
                "id": str(job_id),
                "document_id": doc_id,
                "status": "pending",
                "engine": engine
            })

        conn.commit()
        cur.close()
        conn.close()
        return create_cors_response(200, {"jobs": jobs})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_get_table(event, context):
    """Get table details with fields"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        path_parts = path.split("/")
        table_id = path_parts[4] if len(path_parts) > 4 else None

        print(f"handle_get_table: path={path}, parts={path_parts}, table_id={table_id}, user_sub={user.get('sub')}")

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        cur.execute("SELECT id, name, description, created_at FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        row = cur.fetchone()
        if not row:
            # Debug: check if table exists but for different user
            cur.execute("SELECT id, user_id FROM data_tables WHERE id = %s", (table_id,))
            debug_row = cur.fetchone()
            if debug_row:
                print(f"Table exists but user mismatch: table_user={debug_row[1]}, request_user={user.get('sub')}")
            else:
                print(f"Table not found in database: table_id={table_id}")
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        cur.execute("SELECT id, name, data_type, position FROM data_fields WHERE table_id = %s ORDER BY position", (table_id,))
        fields = [{"id": str(r[0]), "name": r[1], "data_type": r[2], "position": r[3]} for r in cur.fetchall()]

        table = {"id": str(row[0]), "name": row[1], "description": row[2], "created_at": row[3].isoformat(), "fields": fields}
        cur.close()
        conn.close()
        return create_cors_response(200, {"table": table})

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_delete_table(event, context):
    """Delete table"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        path_parts = path.split("/")
        table_id = path_parts[4] if len(path_parts) > 4 else None

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        conn.commit()
        cur.close()
        conn.close()
        return create_cors_response(200, {"success": True}, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_list_rows(event, context):
    """List rows in table"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        path_parts = path.split("/")
        table_id = path_parts[4] if len(path_parts) > 4 else None

        print(f"handle_list_rows: path={path}, table_id={table_id}")

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership first
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        cur.execute("SELECT id, data, created_at FROM data_rows WHERE table_id = %s ORDER BY created_at DESC", (table_id,))
        rows = [{"id": str(r[0]), "data": r[1], "created_at": r[2].isoformat()} for r in cur.fetchall()]
        cur.close()
        conn.close()
        return create_cors_response(200, {"rows": rows}, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_add_rows(event, context):
    """Add rows to table"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        path_parts = path.split("/")
        table_id = path_parts[4] if len(path_parts) > 4 else None
        data = json.loads(event.get("body", "{}"))
        rows = data.get("rows", [])

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership first
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        for row_data in rows:
            row_id = str(uuid.uuid4())
            cur.execute("INSERT INTO data_rows (id, table_id, data, created_at, updated_at) VALUES (%s, %s, %s, NOW(), NOW())",
                       (row_id, table_id, json.dumps(row_data)))
        conn.commit()
        cur.close()
        conn.close()
        return create_cors_response(200, {"success": True}, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_update_table(event, context):
    """Update table metadata"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        path_parts = path.split("/")
        table_id = path_parts[4] if len(path_parts) > 4 else None
        data = json.loads(event.get("body", "{}"))

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Check table exists and belongs to user
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        # Update fields that are provided
        updates = []
        values = []
        if "name" in data:
            updates.append("name = %s")
            values.append(data["name"])
        if "description" in data:
            updates.append("description = %s")
            values.append(data["description"])

        if updates:
            values.extend([table_id, user["sub"]])
            cur.execute(f"UPDATE data_tables SET {', '.join(updates)} WHERE id = %s AND user_id = %s", values)
            conn.commit()

        # Fetch updated table
        cur.execute("SELECT id, name, description, created_at FROM data_tables WHERE id = %s", (table_id,))
        row = cur.fetchone()
        cur.execute("SELECT id, name, data_type, position FROM data_fields WHERE table_id = %s ORDER BY position", (table_id,))
        fields = [{"id": str(f[0]), "name": f[1], "data_type": f[2], "position": f[3]} for f in cur.fetchall()]

        cur.close()
        conn.close()

        return create_cors_response(200, {
            "table": {
                "id": str(row[0]),
                "name": row[1],
                "description": row[2],
                "created_at": row[3].isoformat() if row[3] else None,
                "fields": fields
            }
        }, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_update_row(event, context):
    """Update a single row"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        parts = path.split("/")
        # /api/data/tables/{id}/rows/{rowId}
        table_id = parts[4] if len(parts) > 4 else None
        row_id = parts[6] if len(parts) > 6 else None

        data = json.loads(event.get("body", "{}"))

        if not table_id or not row_id:
            return create_cors_response(400, {"error": "Missing table ID or row ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        # Update row data
        cur.execute("SELECT data FROM data_rows WHERE id = %s AND table_id = %s", (row_id, table_id))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Row not found"}, origin=origin)

        # Merge existing data with new data
        existing_data = row[0] if isinstance(row[0], dict) else json.loads(row[0]) if row[0] else {}
        existing_data.update(data)

        cur.execute("UPDATE data_rows SET data = %s, updated_at = NOW() WHERE id = %s AND table_id = %s",
                   (json.dumps(existing_data), row_id, table_id))
        conn.commit()

        # Fetch updated row
        cur.execute("SELECT id, data, created_at, updated_at FROM data_rows WHERE id = %s", (row_id,))
        updated = cur.fetchone()
        cur.close()
        conn.close()

        return create_cors_response(200, {
            "row": {
                "id": str(updated[0]),
                "data": updated[1] if isinstance(updated[1], dict) else json.loads(updated[1]) if updated[1] else {},
                "created_at": updated[2].isoformat() if updated[2] else None,
                "updated_at": updated[3].isoformat() if updated[3] else None
            }
        }, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_delete_row(event, context):
    """Delete a single row"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        parts = path.split("/")
        table_id = parts[4] if len(parts) > 4 else None
        row_id = parts[6] if len(parts) > 6 else None

        if not table_id or not row_id:
            return create_cors_response(400, {"error": "Missing table ID or row ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        cur.execute("DELETE FROM data_rows WHERE id = %s AND table_id = %s", (row_id, table_id))
        deleted = cur.rowcount > 0
        conn.commit()
        cur.close()
        conn.close()

        if not deleted:
            return create_cors_response(404, {"error": "Row not found"}, origin=origin)

        return create_cors_response(200, {"success": True}, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_list_mappings(event, context):
    """List field mappings for a table"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        parts = path.split("/")
        table_id = parts[4] if len(parts) > 4 else None

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        cur.execute("""
            SELECT id, table_id, source_label, target_field, matcher
            FROM data_field_mappings WHERE table_id = %s
        """, (table_id,))
        mappings = [{
            "id": str(r[0]),
            "table_id": str(r[1]),
            "source_label": r[2],
            "target_field": r[3],
            "matcher": r[4]
        } for r in cur.fetchall()]

        cur.close()
        conn.close()
        return create_cors_response(200, {"mappings": mappings}, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_create_mapping(event, context):
    """Create a field mapping"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        parts = path.split("/")
        table_id = parts[4] if len(parts) > 4 else None
        data = json.loads(event.get("body", "{}"))

        source_label = data.get("sourceLabel", "")
        target_field = data.get("targetField", "")
        matcher = data.get("matcher", "exact")

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        if not source_label or not target_field:
            return create_cors_response(400, {"error": "sourceLabel and targetField are required"}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        mapping_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO data_field_mappings (id, table_id, source_label, target_field, matcher)
            VALUES (%s, %s, %s, %s, %s)
        """, (mapping_id, table_id, source_label, target_field, matcher))
        conn.commit()
        cur.close()
        conn.close()

        return create_cors_response(200, {
            "mapping": {
                "id": mapping_id,
                "table_id": table_id,
                "source_label": source_label,
                "target_field": target_field,
                "matcher": matcher
            }
        }, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_delete_mapping(event, context):
    """Delete a field mapping"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        parts = path.split("/")
        # /api/data/tables/{id}/mappings/{mappingId}
        table_id = parts[4] if len(parts) > 4 else None
        mapping_id = parts[6] if len(parts) > 6 else None

        if not table_id or not mapping_id:
            return create_cors_response(400, {"error": "Missing table ID or mapping ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership
        cur.execute("SELECT id FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        if not cur.fetchone():
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        cur.execute("DELETE FROM data_field_mappings WHERE id = %s AND table_id = %s", (mapping_id, table_id))
        deleted = cur.rowcount > 0
        conn.commit()
        cur.close()
        conn.close()

        if not deleted:
            return create_cors_response(404, {"error": "Mapping not found"}, origin=origin)

        return create_cors_response(200, {"success": True}, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_get_processing_job(event, context):
    """Get a specific processing job"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        parts = path.split("/")
        job_id = parts[3] if len(parts) > 3 else None

        if not job_id:
            return create_cors_response(400, {"error": "Missing job ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT id, document_id, status, engine, result, confidence, error,
                   target_table_id, created_at, updated_at, started_at, completed_at
            FROM processing_jobs WHERE id = %s AND user_id = %s
        """, (job_id, user["sub"]))
        row = cur.fetchone()

        if not row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Job not found"}, origin=origin)

        job = {
            "id": str(row[0]),
            "document_id": row[1],
            "status": row[2],
            "engine": row[3],
            "result": row[4],
            "confidence": row[5],
            "error": row[6],
            "target_table_id": str(row[7]) if row[7] else None,
            "created_at": row[8].isoformat() if row[8] else None,
            "updated_at": row[9].isoformat() if row[9] else None,
            "started_at": row[10].isoformat() if row[10] else None,
            "completed_at": row[11].isoformat() if row[11] else None
        }

        # Get target table info if exists
        if row[7]:
            cur.execute("SELECT id, name FROM data_tables WHERE id = %s", (row[7],))
            table_row = cur.fetchone()
            if table_row:
                job["target_table"] = {"id": str(table_row[0]), "name": table_row[1]}

        cur.close()
        conn.close()
        return create_cors_response(200, {"job": job}, origin=origin)

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

def handle_export_csv(event, context):
    """Export table as CSV"""
    origin = get_origin(event)
    try:
        user = get_current_user(event)
        path = get_request_path(event)
        parts = path.split("/")
        table_id = parts[4] if len(parts) > 4 else None

        if not table_id:
            return create_cors_response(400, {"error": "Missing table ID", "path": path}, origin=origin)

        conn = get_database_connection()
        cur = conn.cursor()

        # Verify table ownership
        cur.execute("SELECT id, name FROM data_tables WHERE id = %s AND user_id = %s", (table_id, user["sub"]))
        table_row = cur.fetchone()
        if not table_row:
            cur.close()
            conn.close()
            return create_cors_response(404, {"error": "Table not found"}, origin=origin)

        # Get fields
        cur.execute("SELECT name FROM data_fields WHERE table_id = %s ORDER BY position", (table_id,))
        field_names = [f[0] for f in cur.fetchall()]

        # Get rows
        cur.execute("SELECT data FROM data_rows WHERE table_id = %s ORDER BY created_at", (table_id,))
        rows = cur.fetchall()

        cur.close()
        conn.close()

        # Build CSV
        import csv
        import io
        output = io.StringIO()
        writer = csv.writer(output)

        # Header
        writer.writerow(field_names)

        # Data rows
        for row in rows:
            row_data = row[0] if isinstance(row[0], dict) else json.loads(row[0]) if row[0] else {}
            writer.writerow([row_data.get(field, "") for field in field_names])

        csv_content = output.getvalue()

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'text/csv',
                'Content-Disposition': f'attachment; filename="{table_row[1]}.csv"',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': 'true'
            },
            'body': csv_content
        }

    except Exception as e:
        if "Not authenticated" in str(e) or "Invalid token" in str(e):
            return create_cors_response(401, {"error": str(e)})
        return create_cors_response(500, {"error": str(e)})

# ─────────────────────────────
# MAIN ROUTER
# ─────────────────────────────

def handler(event, context):
    try:
        # Decode base64-encoded body from API Gateway REST API
        if event.get("isBase64Encoded") and event.get("body"):
            event["body"] = base64.b64decode(event["body"]).decode("utf-8")
            event["isBase64Encoded"] = False

        # Fix API Gateway REST API escaping special chars in body (e.g. \! \# \$)
        if event.get("body"):
            event["body"] = re.sub(r'\\([^"\\/bfnrtu])', r'\1', event["body"])

        method = event.get("requestContext", {}).get("http", {}).get("method") or event.get("httpMethod", "")
        raw_path = event.get("requestContext", {}).get("http", {}).get("path") or event.get("path", "")
        # API Gateway REST API strips the stage name from the path,
        # so we need to prepend /api to match our route definitions
        path = raw_path if raw_path.startswith("/api") else f"/api{raw_path}"

        # Get origin from headers for CORS - set globally so ALL handlers use it
        global _request_origin
        headers = event.get('headers', {})
        origin = headers.get('origin') or headers.get('Origin')
        _request_origin = origin

        print(f"API Request: {method} {path} from origin: {origin}")

        if method == "OPTIONS":
            return create_cors_response(200, "", origin=origin)

        # Health check (support both GET and POST)
        elif path == "/api/health":
            return handle_health(event, context)

        # Auth routes
        elif method == "POST" and path == "/api/auth/signup":
            return handle_signup(event, context)
        elif method == "POST" and path == "/api/auth/login":
            return handle_login(event, context)
        elif method == "GET" and path == "/api/auth/me":
            return handle_auth_me(event, context)
        elif method == "POST" and path == "/api/auth/logout":
            return handle_logout(event, context)
        # MFA routes
        elif method == "POST" and path == "/api/auth/mfa/verify":
            return handle_mfa_verify(event, context)
        elif method == "GET" and path == "/api/auth/mfa/setup":
            return handle_mfa_setup_get(event, context)
        elif method == "POST" and path == "/api/auth/mfa/setup":
            return handle_mfa_setup_post(event, context)
        elif method == "GET" and path == "/api/auth/mfa/status":
            return handle_mfa_status(event, context)
        elif method == "GET" and path == "/api/auth/mfa/enable":
            return handle_mfa_enable_get(event, context)
        elif method == "POST" and path == "/api/auth/mfa/enable":
            return handle_mfa_enable_post(event, context)
        elif method == "POST" and path == "/api/auth/mfa/disable":
            return handle_mfa_disable(event, context)

        # Document routes
        elif method == "GET" and path == "/api/documents":
            return handle_list_documents(event, context)
        elif method == "POST" and path == "/api/documents":
            return handle_upload_document(event, context)
        elif method == "GET" and "/download" in path:
            return handle_download_document(event, context)
        elif method == "GET" and "/view" in path:
            return handle_view_document(event, context)
        elif method == "GET" and path.startswith("/api/documents/"):
            return handle_get_document(event, context)
        elif method == "DELETE" and path.startswith("/api/documents/"):
            return handle_delete_document(event, context)

        # Data tables routes - mappings (must come before generic table routes)
        # /api/data/tables/{id}/mappings has 5 slashes
        elif method == "GET" and "/api/data/tables/" in path and "/mappings" in path and path.count("/") == 5:
            # GET /api/data/tables/{id}/mappings - list mappings
            return handle_list_mappings(event, context)
        elif method == "POST" and "/api/data/tables/" in path and "/mappings" in path and path.count("/") == 5:
            # POST /api/data/tables/{id}/mappings - create mapping
            return handle_create_mapping(event, context)
        elif method == "DELETE" and "/api/data/tables/" in path and "/mappings/" in path:
            # DELETE /api/data/tables/{id}/mappings/{mappingId}
            return handle_delete_mapping(event, context)

        # Data tables routes - fields (add new field column)
        elif method == "POST" and "/api/data/tables/" in path and "/fields" in path and path.count("/") == 5:
            # POST /api/data/tables/{id}/fields - add field
            return handle_add_field(event, context)

        # Data tables routes - CSV import
        elif method == "POST" and "/api/data/tables/" in path and "/import" in path:
            # POST /api/data/tables/{id}/import - import CSV
            return handle_import_csv(event, context)

        # Data tables routes - export (must come before rows)
        elif method == "GET" and "/api/data/tables/" in path and "/export" in path:
            return handle_export_csv(event, context)

        # Data tables routes - rows (with specific row operations)
        elif method == "PATCH" and "/api/data/tables/" in path and "/rows/" in path:
            # PATCH /api/data/tables/{id}/rows/{rowId}
            return handle_update_row(event, context)
        elif method == "DELETE" and "/api/data/tables/" in path and "/rows/" in path:
            # DELETE /api/data/tables/{id}/rows/{rowId}
            return handle_delete_row(event, context)
        elif method == "GET" and "/api/data/tables/" in path and "/rows" in path:
            return handle_list_rows(event, context)
        elif method == "POST" and "/api/data/tables/" in path and "/rows" in path:
            return handle_add_rows(event, context)

        # Data tables routes - table CRUD
        elif method == "GET" and path == "/api/data/tables":
            return handle_list_tables(event, context)
        elif method == "POST" and path == "/api/data/tables":
            return handle_create_table(event, context)
        elif method == "PATCH" and path.startswith("/api/data/tables/"):
            return handle_update_table(event, context)
        elif method == "GET" and path.startswith("/api/data/tables/"):
            return handle_get_table(event, context)
        elif method == "DELETE" and path.startswith("/api/data/tables/"):
            return handle_delete_table(event, context)

        # Processing routes
        elif method == "GET" and path == "/api/processing":
            return handle_list_processing_jobs(event, context)
        elif method == "POST" and path == "/api/processing":
            return handle_queue_processing_jobs(event, context)
        elif method == "DELETE" and path.startswith("/api/processing/") and path != "/api/processing/":
            return handle_delete_processing_job(event, context)
        elif method == "GET" and path.startswith("/api/processing/") and path != "/api/processing/":
            return handle_get_processing_job(event, context)

        # Textract adapters routes
        elif method == "GET" and path == "/api/textract/adapters":
            return handle_list_textract_adapters(event, context)

        else:
            return create_cors_response(404, {"error": "Not found", "path": path, "method": method})

    except Exception as e:
        print(f"Unhandled error: {str(e)}")
        return create_cors_response(500, {"error": str(e)})
