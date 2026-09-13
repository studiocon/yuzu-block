import Image from "next/image";
import { Inter, Unbounded } from "next/font/google";
import "./globals.css";
import { YUZU_WHITE } from "@/lib/palette";
import { FOOTER_COPY, LEAD_COPY } from "@/lib/copy";

const unbounded = Unbounded({
  variable: "--font-display",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-body",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

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
    <html lang="en" className={`${unbounded.variable} ${inter.variable}`}>
      <body>
        <div className="chrome-grid" aria-hidden="true" />
        {children}
        <header className="chrome-header">
          <a
            href="https://yuzu.style"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="YUZU — yuzu.style"
          >
            <Image
              className="chrome-logo"
              src="/logo.svg"
              alt="YUZU — BE TRUE"
              width={720}
              height={236}
              priority
            />
          </a>
        </header>
        <div className="chrome-lead">
          <p className="chrome-lead-headline">{LEAD_COPY.headline}</p>
          <p className="chrome-lead-body">
            {LEAD_COPY.body[0]}
            <br />
            {LEAD_COPY.body[1]}
          </p>
          <p className="chrome-lead-note">{LEAD_COPY.note}</p>
        </div>
        <footer className="chrome-footer">
          <span className="chrome-footer-left">{FOOTER_COPY.left}</span>
          <span className="chrome-footer-center">
            {FOOTER_COPY.centerLabel}
            {"  "}
            <span className="chrome-footer-path">{FOOTER_COPY.centerPath}</span>
          </span>
          <a
            className="chrome-footer-right"
            href={FOOTER_COPY.rightHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {FOOTER_COPY.rightLabel}
          </a>
        </footer>
      </body>
    </html>
  );
}
