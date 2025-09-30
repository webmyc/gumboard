import { auth } from "@/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getBaseUrl } from "@/lib/utils";

async function acceptBoardInvite(boardId: string, token: string) {
  "use server";

  const session = await auth();
  if (!session?.user?.id || !session?.user?.email) {
    throw new Error("Not authenticated");
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
    throw new Error("Invalid or expired invitation");
  }

  if (invite.email !== session.user.email) {
    throw new Error("This invitation is not for your email address");
  }

  if (invite.status !== "PENDING") {
    throw new Error("This invitation has already been processed");
  }

  if (invite.boardId !== boardId) {
    throw new Error("Invitation token does not match board");
  }

  // Check if user exists
  let user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { organization: true },
  });

  if (!user) {
    throw new Error("User not found");
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

    redirect(`/boards/${boardId}`);
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

  redirect(`/boards/${boardId}`);
}

interface AcceptInvitePageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    token?: string;
  }>;
}

export default async function AcceptBoardInvitePage({ params, searchParams }: AcceptInvitePageProps) {
  const { id: boardId } = await params;
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="min-h-screen dark:bg-zinc-950 dark:text-zinc-100 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid invitation</CardTitle>
            <CardDescription>
              This invitation link is missing required information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <a href="/">Go to Gumboard</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get board information for display
  const board = await db.board.findUnique({
    where: { id: boardId },
    include: { organization: true },
  });

  if (!board) {
    return (
      <div className="min-h-screen dark:bg-zinc-950 dark:text-zinc-100 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Board not found</CardTitle>
            <CardDescription>
              The board you're trying to access doesn't exist.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <a href="/">Go to Gumboard</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen dark:bg-zinc-950 dark:text-zinc-100 flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join "{board.name}"</CardTitle>
          <CardDescription>
            You've been invited to collaborate on this board in {board.organization.name}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={acceptBoardInvite.bind(null, boardId, token)}>
            <Button type="submit" className="w-full">
              Accept invitation
            </Button>
          </form>
          <Button asChild variant="outline" className="w-full">
            <a href="/">Cancel</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
