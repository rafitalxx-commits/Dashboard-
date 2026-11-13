export type CommunicationPersonProfile = {
  id?: unknown;
  photoId?: unknown;
};

export function getCurrentUserPhotoId(
  people: readonly CommunicationPersonProfile[] | null | undefined,
  currentUserId: string | null | undefined,
): string | null {
  if (!currentUserId || !people) return null;
  const profile = people.find((person) => person.id === currentUserId);
  return typeof profile?.photoId === "string" && profile.photoId.trim()
    ? profile.photoId
    : null;
}
