import type { CloudPresenceUser } from '@/types/cloudScheme'

/** 将当前客户端排在首位，其余保持原有顺序（与 presence 广播顺序一致）。 */
export function sortOnlineUsersSelfFirst(
  users: CloudPresenceUser[],
  selfClientId: string | null
): CloudPresenceUser[] {
  if (!selfClientId || users.length === 0) {
    return [...users]
  }

  const self = users.find((user) => user.clientId === selfClientId)
  const others = users.filter((user) => user.clientId !== selfClientId)
  return self ? [self, ...others] : [...users]
}

export function joinOnlineDisplayNames(
  users: CloudPresenceUser[],
  selfClientId: string | null,
  separator: string
): string {
  return sortOnlineUsersSelfFirst(users, selfClientId)
    .map((user) => user.displayName)
    .join(separator)
}
