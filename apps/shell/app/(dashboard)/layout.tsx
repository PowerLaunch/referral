import FingerprintCapture from '@/app/components/fingerprint-capture'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      <FingerprintCapture />
    </>
  )
}
