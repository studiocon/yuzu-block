import "./globals.css";
import { YUZU_WHITE } from "@/lib/palette";

export const metadata = {
  title: "yuzu-block (working title)",
  description:
    "Anonymous, aggregate-only voice-journal data rendered as a snapshot 3D block sculpture. Nothing per-user, nothing on screen but the shape.",
  other: {
    "color-scheme": "light",
  },
};

export const viewport = {
  themeColor: YUZU_WHITE,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
