import { db } from '$lib/db';
import { z } from 'zod';
import type { Actions, PageData, PageServerLoad } from './$types';
import { setError, superValidate } from 'sveltekit-superforms/server';
import semesterYear from '../../../components/scripts/semesterYear';
import config from '../../../config.ts';

const updateDuesSchema = z.object({
  email: z.string().email(),
  duesType: z.number()
});

const presidentSchema = z.object({
  presidentId: z.string().optional(),
});

const adminSchema = z.object({
  adminId: z.string().optional(),
});

export const load: PageServerLoad = async ({ locals }) => {
  const form = await superValidate(updateDuesSchema);
  const form1 = await superValidate(presidentSchema);
  const form2 = await superValidate(adminSchema);
  const dateInfo = semesterYear();

  const currentPresident = await db.member.findFirst({
    where: {
      role: {
        name: 'president'
      }
    }
  });

  const currentAdmin = await db.member.findFirst({
    where: {
      role: {
        name: 'admin'
      }
    }
  });

  const members = await db.member.findMany({
    where: {
      email: {not: locals.member?.email}
    },
    select: {
      id: true,
      discordProfileName: true,
      firstName: true,
      lastName: true
    }
  });

  const availableProjects = await db.project.findMany({
    where: {
      year: dateInfo.year,
      season: dateInfo.semester
    },
    include: {
      logo: true
    }
  });

  const user = await db.member.findFirst({
    where: {
      email: locals.member.email
    },
    include: {
      Projects: {
        include: {
          logo: true
        }
      },
      Teams: {
        include: {
          _count: {
            select: {
              members: true
            }
          }
        }
      },
      Survey: true,
      role: true,
    }
  });

  const surveyDateUpdated = user?.Survey?.DateUpdated;

  for (let i = 0; i < availableProjects.length; i++) {
    for (const element of user!.Projects) {
      if (availableProjects[i].id == element.id) {
        availableProjects.splice(i, 1);
      }
    }
  }

  return { user, form, availableProjects, surveyDateUpdated, form1, form2, currentPresident, members, currentAdmin};
};

export const actions: Actions = {
  summerRole: async ({ request }) => {
    const form = await request.formData();
    const id = form.get('id')?.toString();
    if (id) {
      const currentYear = new Date().getFullYear();
      const august = new Date(currentYear, 7, 1);
      const dayOfWeek = august.getDay();
      const firstDayOfFourthWeek = 22 + (7 - dayOfWeek) % 7;

      await db.member.update({
        where: {
          id: id
        },
        data: {
          membershipExpDate: new Date(currentYear, 7, firstDayOfFourthWeek),
          role: {
            connectOrCreate: {
              create: {
                permissionLevel: config.roles.member.level,
                name: config.roles.member.name
              },
              where: {
                name: config.roles.member.name
              }
            }
          }
        }
      });
    }
  },

  joinProject: async ({ request, locals }) => {
    const form = await request.formData();
    const id = Number(form.get('projectID'));

    await db.member.update({
      where: {
        email: locals.member.email
      },
      data: {
        Projects: {
          connect: {
            id: id
          }
        }
      }
    });
  },

  changePresident: async ({ request }) => {
    const formData = await request.formData();
    const form1 = await superValidate(formData, presidentSchema);

    if (!form1.valid) {
      return setError(form1, 'presidentId', 'Invalid president selection.');
    }

    const newPresidentId = form1.data.presidentId;

    if (newPresidentId) {
      const transaction = await db.$transaction(async (tx) => {
        const currentPresident = await tx.member.findFirst({
          where: {
            role: {
              name: 'president'
            }
          }
        });

        if (currentPresident && currentPresident.id !== newPresidentId) {
          await tx.member.update({
            where: {
              id: currentPresident.id
            },
            data: {
              role: {
                connect: {
                  name: 'member'
                }
              }
            }
          });
        }

        await tx.member.update({
          where: {
            id: newPresidentId
          },
          data: {
            role: {
              connect: {
                name: 'president'
              }
            }
          }
        });
      });
      form1.message = 'OK';
      return { form1 };
    }else{
      form1.message = 'NO';
      return { form1 };
    }
  },

  changeAdmin: async ({ request }) => {
    const formData = await request.formData();
    const form2 = await superValidate(formData, adminSchema);

    if (!form2.valid) {
      return setError(form2, 'adminId', 'Invalid admin selection.');
    }

    const newAdminId = form2.data.adminId;

    if (newAdminId) {
      const transaction = await db.$transaction(async (tx) => {
        const currentAdmin = await tx.member.findFirst({
          where: {
            role: {
              name: 'admin'
            }
          }
        });

        if (currentAdmin && currentAdmin.id !== newAdminId) {
          await tx.member.update({
            where: {
              id: currentAdmin.id
            },
            data: {
              role: {
                connect: {
                  name: 'member'
                }
              }
            }
          });
        }

        await tx.member.update({
          where: {
            id: newAdminId
          },
          data: {
            role: {
              connect: {
                name: 'admin'
              }
            }
          }
        });
      });
      form2.message = 'OK';
      return { form2 };
    }else{
      form2.message = 'NO';
      return { form2 };
    }
  }
};
