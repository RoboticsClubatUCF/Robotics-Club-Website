import { db } from '$lib/db';
import { fail } from '@sveltejs/kit';
import { setError, superValidate } from 'sveltekit-superforms/server';
import { z } from 'zod';
import crypto from 'crypto';
import postmark from 'postmark';
import type { Actions, PageServerLoad } from './$types';
import { POSTMARK_API_TOKEN } from '$env/static/private';

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

    // Check if there's an existing token
    const existingToken = await db.passwordResetToken.findFirst({
      where: {
        userId: userInQuestion.id,
      },
    });

    if (existingToken) {
      if (existingToken.expiresAt > new Date()) {
        // Token is still valid
        const remainingTime = Math.floor((existingToken.expiresAt.getTime() - new Date().getTime()) / 1000);
        return {
          form,
          existingToken: true,
          remainingTime,
        };
      } else {
        // Token has expired, delete it
        await db.passwordResetToken.delete({
          where: {
            id: existingToken.id,
          },
        });
      }
    }

    // Generate a new token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date();
    tokenExpiry.setMinutes(tokenExpiry.getMinutes() + 5); // Token valid for 5 minutes

    // Store the token and its expiry in the database
    await db.passwordResetToken.create({
      data: {
        token,
        expiresAt: tokenExpiry,
        userId: userInQuestion.id,
      },
    });

    // Send an email with the reset link
    const client = new postmark.ServerClient(POSTMARK_API_TOKEN);
    const resetLink = `http://rccf.club/forgotPass/reset-password?token=${token}`;

    try {
      await client.sendEmailWithTemplate({
        "From": "RCCF-Web@rccf.club",
        "To": form.data.email,
        "TemplateAlias": "password-reset",
        "TemplateModel": {
          "product_name": "RCCF",
          "name": userInQuestion.firstName,
          "action_url": resetLink,
          "company_name": "Robotics Club of Central Florida",
          "company_address": "3100 Technology Pkwy, Orlando, FL 32826",
        }
      });
      // await client.sendEmail({
      //   From: "RCCF-Web@rccf.club",
      //   To: form.data.email,
      //   Subject: "Password Reset Request",
      //   HtmlBody: `<p>Hello ${userInQuestion.firstName},</p>
      //              <p>Click the link below to reset your password:</p>
      //              <p><a href="${resetLink}">Reset Password</a></p>
      //              <p>This link will expire in 5 minutes.</p>`,
      //   TextBody: `Hello ${userInQuestion.firstName},\n\nClick the link below to reset your password:\n${resetLink}\n\nThis link will expire in 5 minutes.`,
      //   MessageStream: "broadcast"
      // });
    } catch (error) {
      console.error('Error sending email:', error);
      return fail(500, { form, error: 'Failed to send the reset password email.' });
    }

    return { success: true };
  }
};
