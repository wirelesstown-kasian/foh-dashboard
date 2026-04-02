import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { TabNav } from '@/components/layout/TabNav'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'New Village FOH Dashboard',
  description: 'New Village Pub front of house staff management dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.className} h-full`}>
      <body className="h-full flex flex-col bg-gray-50 antialiased overflow-hidden">
        <TabNav />
        <main className="flex-1 overflow-auto">
          <div className="mx-auto h-full w-full max-w-[1400px]">
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
