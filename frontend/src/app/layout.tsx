import type { Metadata } from "next";

import "./globals.css";
import "@copilotkit/react-ui/styles.css";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "AnyCompany Assistant",
  description: "Chat with your multimedia content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ height: '100%', margin: 0, padding: 0 }}>
      <body style={{ height: '100%', margin: 0, padding: 0, overflow: 'hidden' }}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
