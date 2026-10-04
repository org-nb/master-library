/** Roles defined by ADR-0005. Anonymous callers have no role (rank 0). */
export type Role = 'member' | 'librarian'

export const ROLE_RANK: Record<Role, number> = {
	member: 1,
	librarian: 2,
}
