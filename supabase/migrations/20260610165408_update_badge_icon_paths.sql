insert into public.badges (badge_key, name, description, icon_path) values
  ('first-flight', '이륙', '첫 사용량 동기화에 성공했습니다.', '/assets/badges/first-flight.png'),
  ('night-owl', '올빼미', '세션 50개 이상, KST 21시~05시 시작 비율 20% 이상.', '/assets/badges/night-owl.png'),
  ('early-bird', '얼리버드', '세션 50개 이상, KST 07시~10시 시작 비율 20% 이상.', '/assets/badges/early-bird.png'),
  ('dual-wielder', '양손잡이', 'Claude와 Codex를 모두 사용했습니다.', '/assets/badges/dual-wielder.png'),
  ('multi-desk', '멀티 데스크', '기기를 2대 이상 연결했습니다.', '/assets/badges/multi-desk.png'),
  ('steady-flame', '꾸준함', '7일 연속 매일 사용했습니다.', '/assets/badges/steady-flame.png'),
  ('token-burner', '토큰 버너', '하루에 토큰 5,000만 개 이상을 사용했습니다.', '/assets/badges/token-burner.png'),
  ('marathon', '마라톤 세션', '한 세션에서 유저 턴 100회 이상을 기록했습니다.', '/assets/badges/marathon.png'),
  ('podium', '포디움', '참가자 30명 이상인 확정 주간 랭킹에서 Top 10에 들었습니다.', '/assets/badges/podium.png')
on conflict (badge_key) do update
set
  name = excluded.name,
  description = excluded.description,
  icon_path = excluded.icon_path,
  active = true;
