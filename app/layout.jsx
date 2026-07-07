import './globals.css';
import GroupProvider from '../components/GroupProvider.jsx';

export const metadata = {
  title: '내전 밸런스 · 통계',
  description: '리그 오브 레전드 내전 팀 밸런싱 + 기록 + 통계',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <GroupProvider>{children}</GroupProvider>
      </body>
    </html>
  );
}
