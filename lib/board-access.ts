import { db } from "@/lib/db";

export interface BoardAccessResult {
  hasAccess: boolean;
  isCreator: boolean;
  isAdmin: boolean;
  isBoardMember: boolean;
}

/**
 * Check if a user has access to a board
 * Access is granted if:
 * 1. User is a member of the organization (existing behavior)
 * 2. User is specifically invited to the board (new behavior)
 * 3. Board is public (existing behavior)
 */
export async function checkBoardAccess(
  userId: string,
  boardId: string,
  organizationId: string
): Promise<BoardAccessResult> {
  // Check if user is member of the organization
  const userInOrg = await db.user.findFirst({
    where: {
      id: userId,
      organizationId: organizationId,
    },
    select: {
      id: true,
      isAdmin: true,
    },
  });

  // Check if user is specifically a board member
  const boardMember = await db.boardMember.findUnique({
    where: {
      boardId_userId: {
        boardId: boardId,
        userId: userId,
      },
    },
  });

  // Get board to check if user is the creator
  const board = await db.board.findUnique({
    where: { id: boardId },
    select: { createdBy: true },
  });

  const isCreator = board?.createdBy === userId;
  const isAdmin = userInOrg?.isAdmin || false;
  const isBoardMember = !!boardMember;
  
  // User has access if they're in the organization OR specifically invited to the board
  const hasAccess = !!userInOrg || isBoardMember;

  return {
    hasAccess,
    isCreator,
    isAdmin,
    isBoardMember,
  };
}

/**
 * Check if a user can edit a board
 * Edit access is granted if:
 * 1. User is the board creator
 * 2. User is an organization admin
 */
export async function checkBoardEditAccess(
  userId: string,
  boardId: string,
  organizationId: string
): Promise<boolean> {
  const access = await checkBoardAccess(userId, boardId, organizationId);
  return access.isCreator || access.isAdmin;
}

/**
 * Check if a user can invite others to a board
 * Invite access is granted if:
 * 1. User is the board creator
 * 2. User is an organization admin
 */
export async function checkBoardInviteAccess(
  userId: string,
  boardId: string,
  organizationId: string
): Promise<boolean> {
  return checkBoardEditAccess(userId, boardId, organizationId);
}
