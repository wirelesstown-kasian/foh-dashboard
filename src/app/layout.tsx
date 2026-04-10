import type { Metadata } from 'next'
import './globals.css'
import { TabNav } from '@/components/layout/TabNav'

export const metadata: Metadata = {
  title: 'New Village FOH Dashboard',
  description: 'New Village Pub front of house staff management dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col bg-gray-50 antialiased overflow-hidden">
        <TabNav />
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto min-h-full w-full max-w-[1400px]">
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
