'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const authLinks = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/documents', label: 'Documents' },
  { href: '/processing', label: 'Processing' },
  { href: '/data', label: 'Data' },
  { href: '/adapters', label: 'Adapters' },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  // Hide the global NavBar on the home page when not signed in —
  // the landing page renders its own header.
  if (!user && pathname === '/') {
    return null;
  }

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  // When not signed in, only show Home and Documents (pointing to #features)
  const links = user
    ? authLinks
    : [
        { href: '/', label: 'Home' },
        { href: '/#features', label: 'Documents' },
      ];

  return (
    <header className="bg-white border-b border-gray-200 shadow-soft sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="text-xl font-bold bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">
          DOCUPOP
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                  isActive
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {user ? (
          <div className="flex items-center gap-3 text-sm text-gray-700">
            <span>{user.name || user.email}</span>
            <Button size="sm" variant="outline" onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
        ) : (
          <div className="text-sm text-gray-500">Not signed in</div>
        )}
      </div>
    </header>
  );
}

