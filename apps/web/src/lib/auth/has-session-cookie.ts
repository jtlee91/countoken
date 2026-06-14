import { cookies } from "next/headers";

// 스켈레톤(loading.tsx)이 세션 검증 없이 로그인 여부를 싸게 추정하기 위한 헬퍼.
// Supabase @supabase/ssr는 `sb-<ref>-auth-token`(청크 시 `.0`,`.1`) 쿠키에
// 세션을 저장하므로, 해당 쿠키 존재만으로 "로그인 추정"한다. 네트워크/DB 호출 없음.
export async function hasSupabaseSessionCookie(): Promise<boolean> {
  const store = await cookies();
  return store
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith("sb-") &&
        cookie.name.includes("-auth-token") &&
        cookie.value.length > 0,
    );
}
