import { NextResponse } from 'next/server';
import { requireAuth, handleApiError } from '@/lib/auth';

export async function DELETE(req: Request) {
  try {
    // SECURITY: Only admins can delete users
    const { user, supabaseAdmin } = await requireAuth(req, 'admin');
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required.' }, { status: 400 });
    }

    // Prevent admins from accidentally deleting themselves
    if (userId === user.id) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    }

    // This securely deletes them from the Auth system.
    // Our SQL script ensures their flight logs are safely preserved (ON DELETE SET NULL).
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
