import { db } from '$lib/db';
import { fail } from '@sveltejs/kit';
import { setError, superValidate } from 'sveltekit-superforms/server';
import { z } from 'zod';
import crypto from 'crypto';
import postmark from 'postmark';
import type { Actions, PageServerLoad } from './$types';

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

export const load = (async ({ locals }) => {
  const form = await superValidate(forgotPasswordSchema);

  const userInQuestion = await db.member.findUnique({
    where: {
      email: form.data.email
    }
  });

  // Here, you should also check if the user has an existing token
  const existingToken = await db.passwordResetToken.findFirst({
    where: {
      // Assuming `userId` can be retrieved from `locals` or some context
      userId: userInQuestion?.id, 
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  let remainingTime = 0;

  if (existingToken) {
    remainingTime = Math.floor((existingToken.expiresAt.getTime() - new Date().getTime()) / 1000);
  }

  return {
    form,
    existingToken: !!existingToken,
    remainingTime,
  };
}) satisfies PageServerLoad;


export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await superValidate(request, forgotPasswordSchema);
    if (!form.valid) {
      return fail(400, { form });
    }

    const userInQuestion = await db.member.findUnique({
      where: {
        email: form.data.email
      }
    });

    if (!userInQuestion) {
      return setError(form, 'email', 'No account found with that email.');
    }

    // Check if there's an existing valid token
    const existingToken = await db.passwordResetToken.findFirst({
      where: {
        userId: userInQuestion.id,
        expiresAt: {
          gt: new Date(), // Check if the token is still valid
        },
      },
    });

    if (existingToken) {
      // Calculate remaining time in seconds
      const remainingTime = Math.floor((existingToken.expiresAt.getTime() - new Date().getTime()) / 1000);
      return {
        form,
        existingToken: true,
        remainingTime,
      };
    }

    // Generate a secure token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date();
    tokenExpiry.setHours(tokenExpiry.getHours() + 1); // Token valid for 1 hour

    // Store the token and its expiry in the database
    await db.passwordResetToken.create({
      data: {
        token,
        expiresAt: tokenExpiry,
        userId: userInQuestion.id,
      },
    });

    // Send an email with the reset link
    const client = new postmark.ServerClient("b8485332-0c92-408f-b0cb-4224b5164b39");
    const resetLink = `http://localhost:5173/forgotPass/reset-password?token=${token}`;

    try {
      await client.sendEmail({
        From: "RCCF-Web@rccf.club",
        To: form.data.email,
        Subject: "Password Reset Request",
        HtmlBody: `<p>Hello ${userInQuestion.firstName},</p>
                   <p>Click the link below to reset your password:</p>
                   <p><a href="${resetLink}">Reset Password</a></p>
                   <p>This link will expire in 1 hour.</p>`,
        TextBody: `Hello ${userInQuestion.firstName},\n\nClick the link below to reset your password:\n${resetLink}\n\nThis link will expire in 1 hour.`,
        MessageStream: "broadcast"
      });
    } catch (error) {
      console.error('Error sending email:', error);
      return fail(500, { form, error: 'Failed to send the reset password email.' });
    }

    return { success: true };
  }
};
