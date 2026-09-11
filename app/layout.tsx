import "./globals.css";

export const metadata = {
  title: "yuzu-block (working title)",
  description: "Anonymous aggregate voice-journal data rendered as annual rings.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
