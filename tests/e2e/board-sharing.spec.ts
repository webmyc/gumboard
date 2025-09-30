import { test, expect } from "../fixtures/test-helpers";

test.describe("Board Sharing", () => {
  test("should invite user to board and show in pending invites", async ({
    authenticatedPage,
    testContext,
    testPrisma,
  }) => {
    // Create a board first
    const board = await testPrisma.board.create({
      data: {
        name: "Test Board for Sharing",
        organizationId: testContext.organizationId,
        createdBy: testContext.userId,
      },
    });

    await authenticatedPage.goto(`/boards/${board.id}`);
    
    // Open board settings
    await authenticatedPage.click('button[aria-label="Board settings"]');
    await expect(authenticatedPage.locator('text=Board settings')).toBeVisible();

    // Invite a user
    const inviteEmail = "test@example.com";
    await authenticatedPage.fill('input[placeholder="user@example.com"]', inviteEmail);
    
    const responsePromise = authenticatedPage.waitForResponse(
      (resp) => resp.url().includes(`/api/boards/${board.id}/invite`) && resp.status() === 201
    );
    
    await authenticatedPage.click('button:has-text("Invite")');
    await responsePromise;

    // Verify invite was created in database
    const invite = await testPrisma.boardInvite.findFirst({
      where: {
        email: inviteEmail,
        boardId: board.id,
      },
    });

    expect(invite).toBeTruthy();
    expect(invite?.status).toBe("PENDING");

    // Verify invite appears in UI
    await expect(authenticatedPage.locator(`text=${inviteEmail}`)).toBeVisible();
    await expect(authenticatedPage.locator('text=Pending')).toBeVisible();
  });

  test("should add existing organization member directly to board", async ({
    authenticatedPage,
    testContext,
    testPrisma,
  }) => {
    // Create another user in the same organization
    const otherUser = await testPrisma.user.create({
      data: {
        email: "member@example.com",
        name: "Test Member",
        organizationId: testContext.organizationId,
      },
    });

    // Create a board
    const board = await testPrisma.board.create({
      data: {
        name: "Test Board for Member",
        organizationId: testContext.organizationId,
        createdBy: testContext.userId,
      },
    });

    await authenticatedPage.goto(`/boards/${board.id}`);
    
    // Open board settings
    await authenticatedPage.click('button[aria-label="Board settings"]');
    await expect(authenticatedPage.locator('text=Board settings')).toBeVisible();

    // Invite the existing member
    await authenticatedPage.fill('input[placeholder="user@example.com"]', otherUser.email);
    
    const responsePromise = authenticatedPage.waitForResponse(
      (resp) => resp.url().includes(`/api/boards/${board.id}/invite`) && resp.status() === 201
    );
    
    await authenticatedPage.click('button:has-text("Invite")');
    await responsePromise;

    // Verify member was added directly to board
    const boardMember = await testPrisma.boardMember.findFirst({
      where: {
        userId: otherUser.id,
        boardId: board.id,
      },
    });

    expect(boardMember).toBeTruthy();

    // Verify member appears in UI
    await expect(authenticatedPage.locator(`text=${otherUser.email}`)).toBeVisible();
  });

  test("should allow board creator to remove members", async ({
    authenticatedPage,
    testContext,
    testPrisma,
  }) => {
    // Create another user in the same organization
    const otherUser = await testPrisma.user.create({
      data: {
        email: "member@example.com",
        name: "Test Member",
        organizationId: testContext.organizationId,
      },
    });

    // Create a board
    const board = await testPrisma.board.create({
      data: {
        name: "Test Board for Removal",
        organizationId: testContext.organizationId,
        createdBy: testContext.userId,
      },
    });

    // Add the user as a board member
    await testPrisma.boardMember.create({
      data: {
        userId: otherUser.id,
        boardId: board.id,
      },
    });

    await authenticatedPage.goto(`/boards/${board.id}`);
    
    // Open board settings
    await authenticatedPage.click('button[aria-label="Board settings"]');
    await expect(authenticatedPage.locator('text=Board settings')).toBeVisible();

    // Remove the member
    const responsePromise = authenticatedPage.waitForResponse(
      (resp) => resp.url().includes(`/api/boards/${board.id}/members`) && resp.status() === 200
    );
    
    await authenticatedPage.click(`button[aria-label="Remove member"]`);
    await responsePromise;

    // Verify member was removed from database
    const boardMember = await testPrisma.boardMember.findFirst({
      where: {
        userId: otherUser.id,
        boardId: board.id,
      },
    });

    expect(boardMember).toBeFalsy();
  });

  test("should prevent non-creators from inviting users", async ({
    authenticatedPage,
    testContext,
    testPrisma,
  }) => {
    // Create another user in the same organization
    const otherUser = await testPrisma.user.create({
      data: {
        email: "member@example.com",
        name: "Test Member",
        organizationId: testContext.organizationId,
      },
    });

    // Create a board by the other user
    const board = await testPrisma.board.create({
      data: {
        name: "Other User's Board",
        organizationId: testContext.organizationId,
        createdBy: otherUser.id,
      },
    });

    // Add current user as board member
    await testPrisma.boardMember.create({
      data: {
        userId: testContext.userId,
        boardId: board.id,
      },
    });

    await authenticatedPage.goto(`/boards/${board.id}`);
    
    // Open board settings
    await authenticatedPage.click('button[aria-label="Board settings"]');
    await expect(authenticatedPage.locator('text=Board settings')).toBeVisible();

    // Try to invite a user
    await authenticatedPage.fill('input[placeholder="user@example.com"]', "newuser@example.com");
    
    const responsePromise = authenticatedPage.waitForResponse(
      (resp) => resp.url().includes(`/api/boards/${board.id}/invite`) && resp.status() === 403
    );
    
    await authenticatedPage.click('button:has-text("Invite")');
    await responsePromise;

    // Verify no invite was created
    const invite = await testPrisma.boardInvite.findFirst({
      where: {
        email: "newuser@example.com",
        boardId: board.id,
      },
    });

    expect(invite).toBeFalsy();
  });

  test("should show board in dashboard for invited users", async ({
    authenticatedPage,
    testContext,
    testPrisma,
  }) => {
    // Create another user in a different organization
    const otherOrg = await testPrisma.organization.create({
      data: {
        name: "Other Organization",
      },
    });

    const otherUser = await testPrisma.user.create({
      data: {
        email: "other@example.com",
        name: "Other User",
        organizationId: otherOrg.id,
      },
    });

    // Create a board in the other organization
    const board = await testPrisma.board.create({
      data: {
        name: "Shared Board",
        organizationId: otherOrg.id,
        createdBy: otherUser.id,
      },
    });

    // Add current user as board member
    await testPrisma.boardMember.create({
      data: {
        userId: testContext.userId,
        boardId: board.id,
      },
    });

    await authenticatedPage.goto("/dashboard");

    // Verify the shared board appears in dashboard
    await expect(authenticatedPage.locator(`text=${board.name}`)).toBeVisible();
  });

  test("should handle board invite acceptance flow", async ({
    page,
    testContext,
    testPrisma,
  }) => {
    // Create a board
    const board = await testPrisma.board.create({
      data: {
        name: "Invite Test Board",
        organizationId: testContext.organizationId,
        createdBy: testContext.userId,
      },
    });

    // Create an invite
    const invite = await testPrisma.boardInvite.create({
      data: {
        email: "invited@example.com",
        boardId: board.id,
        invitedBy: testContext.userId,
        status: "PENDING",
      },
    });

    // Create a user for the invite
    const invitedUser = await testPrisma.user.create({
      data: {
        email: "invited@example.com",
        name: "Invited User",
        organizationId: testContext.organizationId,
      },
    });

    // Mock authentication for the invited user
    await page.goto(`/boards/${board.id}/invite/accept?token=${invite.id}`);
    
    // The page should redirect to the board after acceptance
    await expect(page).toHaveURL(`/boards/${board.id}`);

    // Verify the user was added as a board member
    const boardMember = await testPrisma.boardMember.findFirst({
      where: {
        userId: invitedUser.id,
        boardId: board.id,
      },
    });

    expect(boardMember).toBeTruthy();

    // Verify the invite status was updated
    const updatedInvite = await testPrisma.boardInvite.findUnique({
      where: { id: invite.id },
    });

    expect(updatedInvite?.status).toBe("ACCEPTED");
  });
});
