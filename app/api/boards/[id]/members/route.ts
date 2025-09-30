import { auth } from "@/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// Get all members of a board
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const boardId = (await params).id;

    // Get board with organization
    const board = await db.board.findUnique({
      where: { id: boardId },
      include: { organization: true },
    });

    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Check if user has access to this board
    const hasAccess = await checkBoardAccess(session.user.id, boardId, board.organizationId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get all board members
    const members = await db.boardMember.findMany({
      where: { boardId: boardId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Also include the board creator
    const boardCreator = await db.user.findUnique({
      where: { id: board.createdBy },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
    });

    // Combine members and creator, avoiding duplicates
    const allMembers = [];
    if (boardCreator) {
      allMembers.push({
        ...boardCreator,
        isCreator: true,
        joinedAt: board.createdAt,
      });
    }

    members.forEach(member => {
      if (member.user.id !== board.createdBy) {
        allMembers.push({
          ...member.user,
          isCreator: false,
          joinedAt: member.createdAt,
        });
      }
    });

    return NextResponse.json({ members: allMembers });
  } catch (error) {
    console.error("Error fetching board members:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Remove a member from a board
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const boardId = (await params).id;
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    // Get board with organization
    const board = await db.board.findUnique({
      where: { id: boardId },
      include: { organization: true },
    });

    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Check if user has permission to remove members (board creator or admin)
    const currentUser = await db.user.findFirst({
      where: {
        id: session.user.id,
        organizationId: board.organizationId,
      },
      select: {
        id: true,
        isAdmin: true,
      },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (board.createdBy !== session.user.id && !currentUser.isAdmin) {
      return NextResponse.json(
        { error: "Only the board creator or admin can remove members" },
        { status: 403 }
      );
    }

    // Cannot remove the board creator
    if (userId === board.createdBy) {
      return NextResponse.json(
        { error: "Cannot remove the board creator" },
        { status: 400 }
      );
    }

    // Remove the board member
    await db.boardMember.deleteMany({
      where: {
        boardId: boardId,
        userId: userId,
      },
    });

    return NextResponse.json({ message: "Member removed from board" });
  } catch (error) {
    console.error("Error removing board member:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Helper function to check if user has access to a board
async function checkBoardAccess(userId: string, boardId: string, organizationId: string): Promise<boolean> {
  // Check if user is member of the organization
  const userInOrg = await db.user.findFirst({
    where: {
      id: userId,
      organizationId: organizationId,
    },
  });

  if (!userInOrg) {
    return false;
  }

  // Check if user is a board member
  const boardMember = await db.boardMember.findUnique({
    where: {
      boardId_userId: {
        boardId: boardId,
        userId: userId,
      },
    },
  });

  // User has access if they're a board member OR if they're in the organization
  // (organization members can see all boards, board members can see specific boards)
  return true;
}
