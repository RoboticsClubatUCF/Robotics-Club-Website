-- DropForeignKey
ALTER TABLE "membership_activations" DROP CONSTRAINT "membership_activations_user_id_fkey";

-- DropTable
DROP TABLE "membership_activations";
