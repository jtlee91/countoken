# Agent Token Plane Web

Claude Code와 Codex 사용량을 로컬 `token-agent`가 집계한 뒤 Supabase에
업로드한 `usage_daily` 데이터를 보여주는 Next.js 웹 대시보드입니다.

Production: https://agent-token-plane.vercel.app

## 위치

이 앱은 `local-agent-usage` monorepo의 `apps/web`에 있습니다.
Vercel Project의 Root Directory도 `apps/web`로 설정해야 합니다.

## 개발

```bash
npm install
npm run dev
```

로컬 개발 서버는 기본적으로 `http://localhost:3000`에서 실행됩니다.

## 환경 변수

`.env.example`을 기준으로 로컬에는 `.env.local`을 만듭니다. 실제 값은 커밋하지 않습니다.

- `NEXT_PUBLIC_SUPABASE_URL`: 브라우저에 노출 가능한 Supabase Project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: 브라우저에 노출 가능한 Supabase publishable key
- `SUPABASE_SECRET_KEY`: 서버 전용 Supabase secret key
- `INGEST_CREDENTIAL_PEPPER`: device별 write-only ingest credential 검증용 서버 비밀값
- `TOKEN_PLANE_DATA_PROVIDER`: 배포 환경은 `supabase`, Supabase 없이 UI만 확인할 때만 `empty`

Vercel에서는 Development, Preview, Production 환경 변수를 분리해서 설정합니다.

## 배포

Vercel Project는 GitHub repository `jtlee91/agent-token-plane`에 연결하고,
Root Directory를 `apps/web`로 설정합니다. 운영 배포는 로컬에서 직접
업로드하지 않고 `main` 브랜치 push로 Vercel Git Integration이 빌드하도록
합니다.

```bash
git push origin main
```

Vercel 환경 변수는 Dashboard 또는 `vercel env`로 관리하되, secret 값은
커밋하지 않습니다.
