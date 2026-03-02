import './globals.css';
import { Inter, Nunito } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });
const nunito = Nunito({ 
  subsets: ['latin'],
  weight: ['400', '600', '700', '800']
});

export const metadata = {
  title: 'IOE Quiz Portal',
  description: 'Online English Quiz Platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body className={nunito.className}>{children}</body>
    </html>
  );
}
