import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/AuthProvider'
import NavBar from '@/components/NavBar'
import { Toaster } from '@/components/ui/toast'

export const metadata: Metadata = {
  title: 'Docupop - Document Management',
  description: 'Secure document management and processing',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <AuthProvider>
          <NavBar />
          <main>{children}</main>
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  )
}