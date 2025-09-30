import { auth } from "@/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const boardId = (await params).id;
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    // Find the invite by token (ID)
    const invite = await db.boardInvite.findUnique({
      where: { id: token },
      include: { 
        board: {
          include: { organization: true }
        }
      },
    });

    if (!invite) {
      return NextResponse.json({ error: "Invalid or expired invitation" }, { status: 404 });
    }

    if (invite.email !== session.user.email) {
      return NextResponse.json({ error: "This invitation is not for your email address" }, { status: 403 });
    }

    if (invite.status !== "PENDING") {
      return NextResponse.json({ error: "This invitation has already been processed" }, { status: 400 });
    }

    if (invite.boardId !== boardId) {
      return NextResponse.json({ error: "Invitation token does not match board" }, { status: 400 });
    }

    // Check if user exists
    let user = await db.user.findUnique({
      where: { id: session.user.id },
      include: { organization: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If user is not in the organization, add them
    if (!user.organizationId || user.organizationId !== invite.board.organizationId) {
      user = await db.user.update({
        where: { id: session.user.id },
        data: { organizationId: invite.board.organizationId },
        include: { organization: true },
      });
    }

    // Check if user is already a board member
    const existingBoardMember = await db.boardMember.findUnique({
      where: {
        boardId_userId: {
          boardId: boardId,
          userId: session.user.id,
        },
      },
    });

    if (existingBoardMember) {
      // Mark invite as accepted even if user is already a member
      await db.boardInvite.update({
        where: { id: token },
        data: { status: "ACCEPTED" },
      });

      return NextResponse.json({ message: "You are already a member of this board" });
    }

    // Add user as board member
    await db.boardMember.create({
      data: {
        boardId: boardId,
        userId: session.user.id,
      },
    });

    // Mark invite as accepted
    await db.boardInvite.update({
      where: { id: token },
      data: { status: "ACCEPTED" },
    });

    return NextResponse.json({ message: "Successfully joined the board" });
  } catch (error) {
    console.error("Error accepting board invite:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
