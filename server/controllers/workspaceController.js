import prisma from "../configs/prisma.js";
import { clerkClient } from "@clerk/express";

const mapClerkRoleToWorkspaceRole = (role = "") => {
    const normalizedRole = String(role).toLowerCase();
    return normalizedRole.includes("admin") ? "ADMIN" : "MEMBER";
};

const ensureUserExists = async (userId) => {
    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (existingUser) return existingUser;

    const clerkUser = await clerkClient.users.getUser(userId);
    const fullName = `${clerkUser.firstName || ""} ${clerkUser.lastName || ""}`.trim() || "User";

    return prisma.user.create({
        data: {
            id: clerkUser.id,
            email: clerkUser.emailAddresses?.[0]?.emailAddress || `${clerkUser.id}@no-email.local`,
            name: fullName,
            image: clerkUser.imageUrl || "",
        },
    });
};

const syncWorkspacesFromClerk = async (userId) => {
    const memberships = await clerkClient.users.getOrganizationMembershipList({ userId, limit: 100 });

    for (const membership of memberships.data) {
        const organization = membership.organization;
        if (!organization?.id) continue;

        // Workspace owner relation points to the org creator in this schema.
        const ownerId = organization.createdBy || userId;
        await ensureUserExists(ownerId);

        await prisma.workspace.upsert({
            where: { id: organization.id },
            update: {
                name: organization.name || "Workspace",
                slug: organization.slug || organization.id,
                image_url: organization.imageUrl || "",
                ownerId,
            },
            create: {
                id: organization.id,
                name: organization.name || "Workspace",
                slug: organization.slug || organization.id,
                ownerId,
                image_url: organization.imageUrl || "",
            },
        });

        await prisma.workspaceMember.upsert({
            where: {
                userId_workspaceId: {
                    userId,
                    workspaceId: organization.id,
                },
            },
            update: {
                role: mapClerkRoleToWorkspaceRole(membership.role),
            },
            create: {
                userId,
                workspaceId: organization.id,
                role: mapClerkRoleToWorkspaceRole(membership.role),
            },
        });
    }
};

// Get all workspaces for user
export const getUserWorkspaces = async (req, res) => {
    try {

        const { userId } = await req.auth();
        await ensureUserExists(userId);

        // Fallback sync so app still works if webhook delivery is delayed/missed.
        await syncWorkspacesFromClerk(userId);

        const workspaces = await prisma.workspace.findMany({
            where: {
                members: { some: { userId: userId } }
            },
            include: {
                members: { include: { user: true } },
                projects: {
                    include: {
                        tasks: { include: { assignee: true, comments: { include: { user: true } } } },
                        members: { include: { user: true } }
                    }
                },
                owner: true
            }
        });
        res.json({ workspaces });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};