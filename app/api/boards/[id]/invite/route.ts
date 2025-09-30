import { auth } from "@/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getBaseUrl } from "@/lib/utils";
import { z } from "zod";
import { boardInviteSchema } from "@/lib/types";

const resend = new Resend(env.AUTH_RESEND_KEY);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const boardId = (await params).id;
    const body = await request.json();

    let validatedBody;
    try {
      validatedBody = boardInviteSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Validation failed", details: error.errors },
          { status: 400 }
        );
      }
      throw error;
    }

    const { email: cleanEmail } = validatedBody;

    // Get board with organization
    const board = await db.board.findUnique({
      where: { id: boardId },
      include: { organization: true },
    });

    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    // Check if user has access to this board (organization member or board creator)
    const currentUser = await db.user.findFirst({
      where: {
        id: session.user.id,
        organizationId: board.organizationId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        isAdmin: true,
      },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check if user can invite to this board (board creator or admin)
    if (board.createdBy !== session.user.id && !currentUser.isAdmin) {
      return NextResponse.json(
        { error: "Only the board creator or admin can invite users to this board" },
        { status: 403 }
      );
    }

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      // User exists, check if they're already a board member
      const existingBoardMember = await db.boardMember.findUnique({
        where: {
          boardId_userId: {
            boardId: boardId,
            userId: existingUser.id,
          },
        },
      });

      if (existingBoardMember) {
        return NextResponse.json(
          { error: "User is already a member of this board" },
          { status: 400 }
        );
      }

      // If user is in the same organization, add them directly
      if (existingUser.organizationId === board.organizationId) {
        const boardMember = await db.boardMember.create({
          data: {
            boardId: boardId,
            userId: existingUser.id,
          },
        });

        return NextResponse.json({ boardMember, message: "User added to board" }, { status: 201 });
      }
      // If user is in a different organization, we'll send an invite
    }

    // Check if there's already a pending invite
    const existingInvite = await db.boardInvite.findUnique({
      where: {
        email_boardId: {
          email: cleanEmail,
          boardId: boardId,
        },
      },
    });

    if (existingInvite && existingInvite.status === "PENDING") {
      return NextResponse.json({ error: "Invite already sent to this email" }, { status: 400 });
    }

    // Create or update the invite
    const invite = await db.boardInvite.upsert({
      where: {
        email_boardId: {
          email: cleanEmail,
          boardId: boardId,
        },
      },
      update: {
        status: "PENDING",
        createdAt: new Date(),
      },
      create: {
        email: cleanEmail,
        boardId: boardId,
        invitedBy: session.user.id,
        status: "PENDING",
      },
    });

    // Send invite email
    try {
      const isExistingUser = !!existingUser;
      const inviteUrl = `${getBaseUrl(request)}/boards/${boardId}/invite/accept?token=${invite.id}`;
      
      await resend.emails.send({
        from: env.EMAIL_FROM,
        to: cleanEmail,
        subject: `${currentUser.name} invited you to collaborate on "${board.name}"`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>You're invited to collaborate on "${board.name}"!</h2>
            <p>${currentUser.name} (${currentUser.email}) has invited you to collaborate on their board "${board.name}" in ${board.organization.name}.</p>
            ${isExistingUser ? `
              <p>Click the link below to accept the invitation:</p>
              <a href="${inviteUrl}" 
                 style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Accept Invitation
              </a>
            ` : `
              <p>To accept this invitation, you'll need to create an account first. Click the link below to get started:</p>
              <a href="${inviteUrl}" 
                 style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Create Account & Join Board
              </a>
              <p style="margin-top: 15px; color: #666; font-size: 14px;">
                This link will create your account and automatically add you to the board.
              </p>
            `}
            <p style="margin-top: 20px; color: #666;">
              If you don't want to receive these emails, please ignore this message.
            </p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error("Failed to send board invite email:", emailError);
      // Don't fail the entire request if email sending fails
    }

    return NextResponse.json({ invite }, { status: 201 });
  } catch (error) {
    console.error("Error creating board invite:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Get all pending invites for a board
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

    // Check if user has access to this board (organization member or board creator)
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

    // Check if user can view invites for this board (board creator or admin)
    if (board.createdBy !== session.user.id && !currentUser.isAdmin) {
      return NextResponse.json(
        { error: "Only the board creator or admin can view board invites" },
        { status: 403 }
      );
    }

    // Get all pending invites for this board
    const invites = await db.boardInvite.findMany({
      where: {
        boardId: boardId,
        status: "PENDING",
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ invites });
  } catch (error) {
    console.error("Error fetching board invites:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
