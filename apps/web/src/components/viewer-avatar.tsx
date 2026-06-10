import Image from "next/image";

import type { ViewerProfile } from "@/lib/data/models";

export function ViewerAvatar({
  viewer,
  size = 32,
}: {
  viewer: ViewerProfile;
  size?: number;
}) {
  if (viewer.avatarUrl) {
    return (
      <Image
        src={viewer.avatarUrl}
        alt={`${viewer.displayName}의 프로필 이미지`}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-token-green to-code-blue font-black text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
    >
      {viewer.initial}
    </span>
  );
}
