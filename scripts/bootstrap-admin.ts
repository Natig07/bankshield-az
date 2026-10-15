import "dotenv/config";
import { stdin, stdout } from "node:process";
import { StringDecoder } from "node:string_decoder";
import { getPrisma } from "../src/lib/db";
import { bootstrapAdministrator } from "../src/lib/auth/service";

async function readHiddenPassword(): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run the bootstrap command in an interactive terminal to enter the password securely.");
  }

  stdout.write("Administrator password (input hidden): ");
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let password = "";
    const decoder = new StringDecoder("utf8");
    const restoreTerminal = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") {
          restoreTerminal();
          stdout.write("\n");
          reject(new Error("Administrator bootstrap cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          restoreTerminal();
          stdout.write("\n");
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
        } else if (character >= " ") {
          password += character;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Administrator bootstrap is disabled in production.");
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const name = process.env.BOOTSTRAP_ADMIN_NAME;
  if (!email || !name) {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME before running this command.");
  }

  const password = await readHiddenPassword();
  const prisma = getPrisma();
  try {
    const administrator = await bootstrapAdministrator(
      prisma,
      { email, name, password },
      false,
    );
    console.log(`Created the initial administrator account for ${administrator.email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Administrator bootstrap failed.";
  console.error(message);
  process.exitCode = 1;
});
