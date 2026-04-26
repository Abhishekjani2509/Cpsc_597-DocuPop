"""
AWS Textract OCR Module

Uses AWS Textract for document text extraction in production.
Provides field extraction with confidence scores.

Security features:
- IAM role-based authentication (no hardcoded credentials)
- Uses boto3 with automatic credential discovery
- Supports S3 document input
"""

import re
from typing import Dict, Any, List, Tuple, Optional
import boto3
from botocore.exceptions import ClientError


# Initialize AWS clients (credentials from IAM role or environment)
textract_client = boto3.client('textract')  # default region for basic OCR
# Adapters only exist in us-east-1; used selectively in analyze_document_with_queries
_textract_client_us_east_1 = boto3.client('textract', region_name='us-east-1')
s3_client = boto3.client('s3')


DOCUMENT_NAME_FIELD = "DocumentName"


def match_query_to_field(query_text: str, field_names: List[str]) -> Optional[str]:
    """
    Match a query text to a target table field name using fuzzy matching.

    Args:
        query_text: The query text (e.g., "What company was this invoice from?")
        field_names: List of target table field names

    Returns:
        Matching field name or None
    """
    query_lower = query_text.lower()

    # Extract key words from the query (remove common question words)
    stop_words = {'what', 'is', 'the', 'a', 'an', 'was', 'were', 'this', 'that', 'from', 'for', 'of', 'in', 'on', 'to', 'and', 'or'}
    query_words = set(re.sub(r'[^\w\s]', '', query_lower).split()) - stop_words

    best_match = None
    best_score = 0

    for field_name in field_names:
        field_lower = field_name.lower()
        field_words = set(re.sub(r'[_\s]+', ' ', field_lower).split())

        # Check for exact match
        if field_lower in query_lower:
            return field_name

        # Check if any field word is in the query
        common_words = query_words & field_words
        if common_words:
            score = len(common_words) / len(field_words)
            if score > best_score:
                best_score = score
                best_match = field_name

        # Check for partial matches (e.g., "company" matches "Company Name")
        for field_word in field_words:
            if len(field_word) >= 3 and field_word in query_lower:
                if best_score < 0.5:
                    best_score = 0.5
                    best_match = field_name

    return best_match if best_score > 0 else None


def get_adapter_trained_queries(
    adapter_id: str,
    adapter_version: str,
    target_field_names: Optional[List[str]] = None
) -> Optional[List[Dict[str, str]]]:
    """
    Fetch the queries that an adapter was trained on from its manifest in S3.
    Maps queries to target table field names as aliases.

    Args:
        adapter_id: The adapter ID
        adapter_version: The adapter version
        target_field_names: Optional list of target table field names to map queries to

    Returns:
        List of query dicts with 'Text' and optionally 'Alias' keys, or None if unable to fetch
    """
    try:
        # Get adapter version details to find the manifest location
        version_info = textract_client.get_adapter_version(
            AdapterId=adapter_id,
            AdapterVersion=adapter_version
        )

        dataset_config = version_info.get('DatasetConfig', {})
        manifest_s3 = dataset_config.get('ManifestS3Object', {})
        bucket = manifest_s3.get('Bucket')
        key = manifest_s3.get('Name')

        if not bucket or not key:
            print(f"[WARN] No manifest found for adapter {adapter_id} version {adapter_version}")
            return None

        print(f"[INFO] Fetching adapter manifest from s3://{bucket}/{key}")

        # Download and parse the manifest (JSONL format)
        response = s3_client.get_object(Bucket=bucket, Key=key)
        manifest_content = response['Body'].read().decode('utf-8')

        # Parse first line to get the queries (all lines should have same queries)
        import json
        queries_set = set()
        for line in manifest_content.strip().split('\n'):
            if not line:
                continue
            try:
                entry = json.loads(line)
                annotations_metadata = entry.get('annotations-ref-metadata', {})
                queries_list = annotations_metadata.get('queries', [])
                for q in queries_list:
                    query_text = q.get('query-text')
                    if query_text:
                        queries_set.add(query_text)
            except json.JSONDecodeError:
                continue
            # Only need to parse first few entries to get all queries
            if len(queries_set) > 0:
                break

        if not queries_set:
            print(f"[WARN] No queries found in adapter manifest")
            return None

        # Convert to Textract query format, mapping to target fields if provided
        trained_queries = []
        for query_text in queries_set:
            query_item = {"Text": query_text}

            # Try to match query to a target field name for the alias
            if target_field_names:
                matched_field = match_query_to_field(query_text, target_field_names)
                if matched_field:
                    query_item["Alias"] = matched_field
                    print(f"[INFO] Mapped query '{query_text}' -> field '{matched_field}'")
                else:
                    print(f"[WARN] No matching field found for query: '{query_text}'")

            trained_queries.append(query_item)

        print(f"[INFO] Found {len(trained_queries)} trained queries")
        return trained_queries

    except ClientError as e:
        print(f"[ERROR] Failed to fetch adapter queries: {e}")
        return None
    except Exception as e:
        print(f"[ERROR] Unexpected error fetching adapter queries: {e}")
        return None


def analyze_document_with_queries(
    bucket: str,
    key: str,
    queries: Optional[List[Dict[str, Any]]] = None,
    adapter_id: Optional[str] = None,
    adapter_version: Optional[str] = None,
    adapter_feature_types: Optional[List[str]] = None,
    target_field_names: Optional[List[str]] = None
) -> Tuple[str, List[Dict[str, Any]], Dict[str, Any]]:
    """
    Analyze document using Textract AnalyzeDocument API with custom queries and/or adapter.

    This provides more accurate extraction for known document types compared to
    basic detect_document_text.

    Args:
        bucket: S3 bucket name
        key: S3 object key
        queries: List of query configs, each with:
            - text: The query (e.g., "What is the invoice number?")
            - alias: Optional field name alias for the result
            - pages: Optional list of page numbers to query
        adapter_id: Optional custom adapter ID for specialized document processing
        adapter_version: Optional adapter version (uses latest if not specified)
        adapter_feature_types: Feature types the adapter was trained on (e.g., ["QUERIES"] or ["FORMS"])
        target_field_names: List of target table field names to map query results to

    Returns:
        Tuple of (full_text, blocks, query_results) where:
            - full_text: Extracted document text
            - blocks: Raw Textract response blocks
            - query_results: Dict mapping query alias/text to extracted value and confidence

    Raises:
        ClientError: If Textract API fails
    """
    try:
        # Build the API request
        request_params = {
            "Document": {
                "S3Object": {
                    "Bucket": bucket,
                    "Name": key
                }
            },
            "FeatureTypes": []
        }

        # Add queries if provided
        if queries:
            request_params["FeatureTypes"].append("QUERIES")
            request_params["QueriesConfig"] = {
                "Queries": []
            }
            for q in queries:
                query_item = {"Text": q.get("text", q.get("Text", ""))}
                alias = q.get("alias", q.get("Alias"))
                if alias:
                    query_item["Alias"] = alias
                pages = q.get("pages", q.get("Pages"))
                if pages:
                    query_item["Pages"] = pages
                request_params["QueriesConfig"]["Queries"].append(query_item)

            print(f"[INFO] Using {len(queries)} custom queries")

        # Add adapter if provided (Version is required by Textract API)
        if adapter_id:
            # Version is required - use "1" as default if not specified
            version = adapter_version if adapter_version else "1"
            request_params["AdaptersConfig"] = {
                "Adapters": [{
                    "AdapterId": adapter_id,
                    "Version": version
                }]
            }
            print(f"[INFO] Using custom adapter: {adapter_id} (version: {version})")

            # Use the adapter's feature types dynamically
            if adapter_feature_types:
                for ft in adapter_feature_types:
                    if ft not in request_params["FeatureTypes"]:
                        request_params["FeatureTypes"].append(ft)
                print(f"[INFO] Using adapter feature types: {adapter_feature_types}")

                # QUERIES feature type requires QueriesConfig
                # If user didn't provide queries, fetch adapter's trained queries
                if "QUERIES" in adapter_feature_types and not queries:
                    trained_queries = get_adapter_trained_queries(adapter_id, version, target_field_names)
                    if trained_queries:
                        request_params["FeatureTypes"].append("QUERIES") if "QUERIES" not in request_params["FeatureTypes"] else None
                        request_params["QueriesConfig"] = {
                            "Queries": trained_queries
                        }
                        print(f"[INFO] Using {len(trained_queries)} trained queries from adapter")
                    else:
                        print("[WARN] Could not retrieve adapter's trained queries, falling back to FORMS")
                        # Remove QUERIES from feature types if we can't get queries
                        request_params["FeatureTypes"] = [ft for ft in request_params["FeatureTypes"] if ft != "QUERIES"]
                        if "FORMS" not in request_params["FeatureTypes"]:
                            request_params["FeatureTypes"].append("FORMS")

        # If no features specified, add FORMS as default for AnalyzeDocument
        if not request_params["FeatureTypes"]:
            request_params["FeatureTypes"].append("FORMS")

        # Adapters live in us-east-1 but the S3 bucket is in us-west-1.
        # Textract in us-east-1 cannot access cross-region S3, so for adapter calls
        # we download the bytes locally (Lambda→S3 is same region) and send as Bytes.
        if adapter_id:
            s3_doc = request_params["Document"]["S3Object"]
            obj = s3_client.get_object(Bucket=s3_doc["Bucket"], Key=s3_doc["Name"])
            doc_bytes = obj["Body"].read()
            request_params["Document"] = {"Bytes": doc_bytes}

        import json
        print(f"[DEBUG] AnalyzeDocument request (doc omitted): {json.dumps({k: v for k, v in request_params.items() if k != 'Document'}, default=str)}")

        client = _textract_client_us_east_1 if adapter_id else textract_client
        response = client.analyze_document(**request_params)

        blocks = response.get("Blocks", [])

        # Extract text from LINE blocks
        lines = []
        for block in blocks:
            if block["BlockType"] == "LINE":
                lines.append(block.get("Text", ""))
        full_text = "\n".join(lines)

        # Extract query results
        query_results = {}
        query_blocks = {}

        # First pass: collect QUERY blocks and their relationships
        for block in blocks:
            if block["BlockType"] == "QUERY":
                query_text = block.get("Query", {}).get("Text", "")
                query_alias = block.get("Query", {}).get("Alias", query_text)
                query_blocks[block["Id"]] = {
                    "alias": query_alias,
                    "text": query_text,
                    "relationships": block.get("Relationships", [])
                }

        # Second pass: find QUERY_RESULT blocks and link to queries
        for block in blocks:
            if block["BlockType"] == "QUERY_RESULT":
                result_id = block["Id"]
                result_text = block.get("Text", "")
                result_confidence = block.get("Confidence", 0) / 100.0  # Convert to 0-1 scale

                # Find which query this result belongs to
                for query_id, query_info in query_blocks.items():
                    for rel in query_info["relationships"]:
                        if rel["Type"] == "ANSWER" and result_id in rel.get("Ids", []):
                            alias = query_info["alias"]
                            query_results[alias] = {
                                "value": result_text,
                                "confidence": result_confidence,
                                "query_text": query_info["text"]
                            }
                            print(f"[INFO] Query '{alias}': {result_text} (confidence: {result_confidence:.2f})")

        return full_text, blocks, query_results

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_message = e.response["Error"]["Message"]
        raise Exception(f"Textract AnalyzeDocument error ({error_code}): {error_message}")


def extract_text_from_s3(bucket: str, key: str) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Extract text from document in S3 using AWS Textract.

    Args:
        bucket: S3 bucket name
        key: S3 object key

    Returns:
        Tuple of (full_text, blocks) where blocks contain Textract response blocks

    Raises:
        ClientError: If Textract API fails
    """
    try:
        # Use Textract's detect_document_text for simple text extraction
        response = textract_client.detect_document_text(
            Document={
                'S3Object': {
                    'Bucket': bucket,
                    'Name': key
                }
            }
        )

        blocks = response.get('Blocks', [])

        # Extract all LINE blocks to build full text
        lines = []
        for block in blocks:
            if block['BlockType'] == 'LINE':
                lines.append(block.get('Text', ''))

        full_text = '\n'.join(lines)

        return full_text, blocks

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        raise Exception(f"Textract error ({error_code}): {error_message}")


def extract_text_from_bytes(document_bytes: bytes, content_type: str) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Extract text from document bytes using AWS Textract.

    Args:
        document_bytes: Raw document bytes
        content_type: MIME type (e.g., 'application/pdf', 'image/png')

    Returns:
        Tuple of (full_text, blocks)
    """
    try:
        response = textract_client.detect_document_text(
            Document={
                'Bytes': document_bytes
            }
        )

        blocks = response.get('Blocks', [])

        lines = []
        for block in blocks:
            if block['BlockType'] == 'LINE':
                lines.append(block.get('Text', ''))

        full_text = '\n'.join(lines)

        return full_text, blocks

    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        raise Exception(f"Textract error ({error_code}): {error_message}")


def normalize(value: str) -> str:
    """Normalize string for comparison (lowercase, alphanumeric only)"""
    return re.sub(r"[^a-z0-9]", "", value.lower())


def generate_field_variations(field_name: str) -> List[str]:
    """
    Generate variations of a field name to search for in the document.

    Args:
        field_name: The target field name (e.g., "Invoice Number", "customer_name")

    Returns:
        List of variations to search for
    """
    variations = [field_name]

    # Add lowercase version
    variations.append(field_name.lower())

    # Add uppercase version
    variations.append(field_name.upper())

    # Replace underscores with spaces
    if "_" in field_name:
        variations.append(field_name.replace("_", " "))
        variations.append(field_name.replace("_", " ").title())

    # Replace spaces with nothing (for matching "InvoiceNumber" to "Invoice Number")
    if " " in field_name:
        variations.append(field_name.replace(" ", ""))

    # Add common label variations
    lower = field_name.lower()
    if "number" in lower or "no" in lower or "num" in lower or "#" in lower:
        base = re.sub(r"(number|no\.?|num|#)", "", lower, flags=re.IGNORECASE).strip()
        if base:
            variations.extend([f"{base} #", f"{base} No", f"{base} No.", f"{base} Number", f"{base}#"])

    # Add colon variations
    variations.extend([f"{v}:" for v in variations[:3]])

    return list(set(variations))


def extract_value_for_field(text: str, field_name: str) -> Tuple[str, float]:
    """
    Intelligently extract a value for a specific field name from document text.

    Args:
        text: Full document text
        field_name: The field name to search for

    Returns:
        Tuple of (extracted_value, confidence_score)
    """
    if not field_name:
        return "", 0.0

    lines = text.splitlines()
    variations = generate_field_variations(field_name)

    # Strategy 1: Look for "Label: Value" or "Label Value" patterns
    for variation in variations:
        escaped = re.escape(variation)
        # Match label followed by colon/dash/space and then the value
        patterns = [
            rf"{escaped}\s*[:\-]\s*(.+)",  # Label: Value or Label - Value
            rf"{escaped}\s+(.+)",           # Label Value (space separated)
        ]

        for pattern_str in patterns:
            pattern = re.compile(pattern_str, re.IGNORECASE)
            for line in lines:
                match = pattern.search(line)
                if match:
                    value = match.group(1).strip()
                    # Clean up the value - remove trailing labels
                    value = re.split(r'\s{2,}|\t', value)[0].strip()
                    if value and len(value) < 200:  # Sanity check
                        return value, 0.85

    # Strategy 2: Look for the field name and get the value on the same or next line
    for variation in variations:
        for i, line in enumerate(lines):
            if variation.lower() in line.lower():
                # Check if value is on the same line after the label
                parts = re.split(rf"{re.escape(variation)}", line, flags=re.IGNORECASE)
                if len(parts) > 1:
                    value = parts[1].strip().lstrip(":- \t")
                    if value and len(value) < 200:
                        return value, 0.75

                # Check next line for the value
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    if next_line and not any(v.lower() in next_line.lower() for v in variations):
                        if len(next_line) < 200:
                            return next_line, 0.65

    # Strategy 3: Smart pattern matching based on field name semantics
    lower_field = field_name.lower()

    # Date fields
    if any(x in lower_field for x in ["date", "dated", "day"]):
        date_patterns = [
            r'\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b',  # MM/DD/YYYY, DD-MM-YYYY
            r'\b(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b',    # YYYY-MM-DD
            r'\b([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b',       # January 1, 2024
            r'\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b',         # 1 January 2024
        ]
        for pattern in date_patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(1), 0.70

    # Amount/money fields
    if any(x in lower_field for x in ["amount", "total", "price", "cost", "fee", "balance", "due", "paid", "payment"]):
        money_patterns = [
            r'\$\s*([\d,]+\.?\d*)',           # $1,234.56
            r'([\d,]+\.?\d*)\s*(?:USD|dollars?)', # 1234.56 USD
            r'(?:total|amount|due|balance)[:\s]*([\d,]+\.?\d*)', # Total: 1234
        ]
        for pattern in money_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1).replace(",", ""), 0.70

    # Number/ID fields
    if any(x in lower_field for x in ["number", "no", "num", "#", "id", "code", "ref"]):
        # Look for patterns near the field name context
        for variation in variations[:3]:
            pattern = rf"{re.escape(variation)}[:\s#]*([A-Za-z0-9\-]+)"
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1), 0.70

    # Name fields
    if any(x in lower_field for x in ["name", "customer", "client", "vendor", "company", "business"]):
        for variation in variations[:3]:
            pattern = rf"{re.escape(variation)}[:\s]+([A-Za-z][A-Za-z\s\.,'&\-]+)"
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = match.group(1).strip()
                # Limit to reasonable name length
                value = " ".join(value.split()[:5])
                if value:
                    return value, 0.70

    # Email fields
    if any(x in lower_field for x in ["email", "e-mail"]):
        email_pattern = r'\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b'
        match = re.search(email_pattern, text)
        if match:
            return match.group(1), 0.90

    # Phone fields
    if any(x in lower_field for x in ["phone", "tel", "mobile", "cell", "fax"]):
        phone_patterns = [
            r'\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}',  # (123) 456-7890
            r'\+?\d{1,3}[\s\-\.]?\d{3,4}[\s\-\.]?\d{3,4}[\s\-\.]?\d{3,4}',  # +1-234-567-8900
        ]
        for pattern in phone_patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(0), 0.80

    # Address fields
    if any(x in lower_field for x in ["address", "street", "city", "state", "zip", "postal"]):
        for variation in variations[:3]:
            pattern = rf"{re.escape(variation)}[:\s]+(.+)"
            for line in lines:
                match = re.search(pattern, line, re.IGNORECASE)
                if match:
                    return match.group(1).strip(), 0.65

    return "", 0.0


def extract_value_by_label(text: str, label: str) -> Tuple[str, float]:
    """
    Extract value following a label in text (legacy function, now uses smarter extraction).
    """
    return extract_value_for_field(text, label)


def build_field_entry(value: str, confidence: float) -> Dict[str, Any]:
    """Build field entry with value and confidence"""
    return {
        "value": value,
        "confidence": confidence,
    }


def infer_fields(text: str, target_table: Optional[Dict], document_name: str) -> Dict[str, Any]:
    """
    Extract structured fields from OCR text based on target table schema.

    Uses intelligent field extraction that:
    1. First tries explicit field mappings (source_label -> target_field)
    2. Then searches for each target table field name in the document
    3. Uses semantic understanding to find dates, amounts, names, etc.

    Args:
        text: Full OCR text
        target_table: Target table schema with fields and mappings
        document_name: Name of source document

    Returns:
        Dictionary of field_name -> {value, confidence}
    """
    fields: Dict[str, Any] = {}

    # Get table fields and mappings
    table_fields = target_table.get("fields", []) if target_table else []
    mappings = target_table.get("mappings", []) if target_table else []

    print(f"[INFO] Extracting data for {len(table_fields)} target fields")

    # First, use explicit mappings if provided
    for mapping in mappings:
        source_label = mapping.get("source_label", "")
        target_field = mapping.get("target_field", "")

        if not target_field:
            continue

        value, confidence = extract_value_for_field(text, source_label)
        if value:
            fields[target_field] = build_field_entry(value, confidence)
            print(f"[INFO] Mapped '{source_label}' -> '{target_field}': {value[:50]}...")

    # Then, intelligently extract remaining fields by searching for their names
    for field in table_fields:
        name = field.get("name", "")

        if not name or name in fields:
            continue

        # Use the smart extraction function
        value, confidence = extract_value_for_field(text, name)
        if value:
            fields[name] = build_field_entry(value, confidence)
            print(f"[INFO] Found '{name}': {value[:50] if len(value) > 50 else value}")
        else:
            print(f"[DEBUG] Could not find value for '{name}'")

    # Always include document name if there's a matching field
    for field in table_fields:
        name = field.get("name", "").lower()
        if any(x in name for x in ["document", "file", "filename", "source"]):
            if field.get("name") not in fields:
                fields[field.get("name")] = build_field_entry(document_name, 1.0)
                print(f"[INFO] Set '{field.get('name')}' to document name: {document_name}")
                break

    print(f"[INFO] Extracted {len(fields)} fields total")

    return fields


def calculate_overall_confidence(fields: Dict[str, Any]) -> float:
    """
    Calculate overall confidence score from all field confidences.

    Args:
        fields: Dictionary of extracted fields

    Returns:
        Average confidence score (0.0 to 1.0)
    """
    confidences = [
        cell.get("confidence", 0)
        for cell in fields.values()
        if isinstance(cell, dict) and "confidence" in cell
    ]

    if not confidences:
        return 0.5

    return sum(confidences) / len(confidences)


def process_document_from_s3(
    bucket: str,
    key: str,
    target_table: Optional[Dict],
    document_name: str,
    queries: Optional[List[Dict[str, Any]]] = None,
    adapter_id: Optional[str] = None,
    adapter_version: Optional[str] = None,
    adapter_feature_types: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Complete OCR processing pipeline for S3 document.

    Uses AnalyzeDocument with queries/adapter if provided, otherwise falls back
    to basic DetectDocumentText.

    Args:
        bucket: S3 bucket name
        key: S3 object key
        target_table: Target table schema (optional)
        document_name: Original document filename
        queries: Optional list of custom queries for targeted extraction
        adapter_id: Optional custom adapter ID for specialized documents
        adapter_version: Optional adapter version
        adapter_feature_types: Feature types the adapter was trained on

    Returns:
        OCR result with text, fields, rows, metadata, and confidence
    """
    query_results = {}
    engine = "textract"

    # Extract target field names for query mapping
    target_field_names = None
    if target_table:
        table_fields = target_table.get("fields", [])
        target_field_names = [f.get("name") for f in table_fields if f.get("name")]
        print(f"[INFO] Target table has {len(target_field_names)} fields: {target_field_names}")

    # Use AnalyzeDocument if queries or adapter provided, otherwise basic detection
    if queries or adapter_id:
        text, blocks, query_results = analyze_document_with_queries(
            bucket=bucket,
            key=key,
            queries=queries,
            adapter_id=adapter_id,
            adapter_version=adapter_version,
            adapter_feature_types=adapter_feature_types,
            target_field_names=target_field_names
        )
        engine = "textract-queries" if queries else "textract-adapter"
        if queries and adapter_id:
            engine = "textract-adapter-queries"
        print(f"[INFO] Used AnalyzeDocument API (engine: {engine})")
    else:
        # Fall back to basic text extraction
        text, blocks = extract_text_from_s3(bucket, key)
        print(f"[INFO] Used DetectDocumentText API (basic OCR)")

    # Extract structured fields using pattern matching
    fields = infer_fields(text, target_table, document_name)

    # Merge query results into fields (query results take precedence with higher confidence)
    if query_results:
        for alias, result in query_results.items():
            # Map query alias to target table field if possible
            field_name = alias
            if target_table:
                # Check if alias matches a field name in target table
                table_fields = target_table.get("fields", [])
                for tf in table_fields:
                    tf_name = tf.get("name", "")
                    # Match by exact name or normalized comparison
                    if tf_name == alias or normalize(tf_name) == normalize(alias):
                        field_name = tf_name
                        break

            # Query results override pattern-matched fields (higher confidence from ML)
            fields[field_name] = {
                "value": result["value"],
                "confidence": result["confidence"],
                "source": "query"
            }
            print(f"[INFO] Query result mapped: '{alias}' -> '{field_name}'")

    # Build rows (one row per document)
    rows: List[Dict[str, Any]] = [fields] if fields else []

    # Calculate overall confidence
    overall_confidence = calculate_overall_confidence(fields)

    return {
        "text": text,
        "fields": fields,
        "rows": rows,
        "metadata": {
            "field_count": len(fields),
            "block_count": len(blocks),
            "engine": engine,
            "used_queries": bool(queries),
            "used_adapter": bool(adapter_id),
            "query_count": len(queries) if queries else 0,
        },
        "confidence": overall_confidence,
    }


def process_document_from_bytes(
    document_bytes: bytes,
    content_type: str,
    target_table: Optional[Dict],
    document_name: str
) -> Dict[str, Any]:
    """
    Complete OCR processing pipeline for document bytes.

    Args:
        document_bytes: Raw document bytes
        content_type: MIME type
        target_table: Target table schema (optional)
        document_name: Original document filename

    Returns:
        OCR result with text, fields, rows, metadata, and confidence
    """
    # Extract text using Textract
    text, blocks = extract_text_from_bytes(document_bytes, content_type)

    # Extract structured fields
    fields = infer_fields(text, target_table, document_name)

    # Build rows
    rows: List[Dict[str, Any]] = [fields] if fields else []

    # Calculate overall confidence
    overall_confidence = calculate_overall_confidence(fields)

    return {
        "text": text,
        "fields": fields,
        "rows": rows,
        "metadata": {
            "field_count": len(fields),
            "block_count": len(blocks),
            "engine": "textract",
        },
        "confidence": overall_confidence,
    }
