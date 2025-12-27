#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";
import cpy from "cpy";
import { execa } from "execa";
import fs from "fs-extra";
import { oraPromise } from "ora";
import pico from "picocolors";
import { default as prompts } from "prompts";
// @ts-ignore
import rootPackageJson from "../package.json" assert { type: "json" };
import { getPackageManager } from "./helpers/getPackageManager.js";
import { notifyUpdate } from "./helpers/notifyUpdate.js";
import {
  ValidationError,
  validateProjectName,
  validateProjectPath,
  validateTemplateName,
} from "./helpers/validate.js";

const log = console.log;

export type Template = {
  title: string;
  description: string;
  id: string;
};

export type CLIArgs = readonly string[];
export type CLIOptions = {
  [k: string]: any;
};

const templates = [
  {
    id: "reference-erc20",
    title: "Reference - ERC20 token",
    description: "A Ponder app for an ERC20 token",
  },
  {
    id: "feature-factory",
    title: "Feature - Factory contract",
    description: "A Ponder app using a factory contract",
  },
  {
    id: "feature-paymaster",
    title: "Feature - Paymaster (AVNU)",
    description: "Index AVNU Paymaster sponsored transactions",
  },
  {
    id: "l1-handler-bridge",
    title: "L1 Handler - Bridge",
    description: "Track L1↔L2 bridge messages via wBTC Bridge",
  },
  {
    id: "project-ekubo",
    title: "Project - Ekubo Protocol",
    description: "A ponder app that indexes Ekubo initialized pools and swaps",
  },
  {
    id: "project-vesu",
    title: "Project - Vesu Protocol",
    description: "A ponder app that indexes Vesu Pool Factory VTokens",
  },
  { id: "blank", title: "Blank", description: "Start from scratch" },
] as const satisfies readonly Template[];

export async function run({
  args,
  options,
}: {
  args: CLIArgs;
  options: CLIOptions;
}) {
  if (options.help) return;

  const warnings: string[] = [];

  log();
  log(
    `Welcome to ${pico.bold(
      pico.blue("create-starknet-ponder"),
    )} – the quickest way to get started with Starknet Ponder!`,
  );
  log();

  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const templatesPath = path.join(__dirname, "..", "templates");
  let templateId = options.template || options.t;

  // Validate template if provided
  let templateValidation = await validateTemplateName({
    isNameRequired: false,
    templateId,
    templates,
  });
  if (!templateValidation.valid) throw new ValidationError(templateValidation);

  // Project name.
  let projectName: string;
  // Absolute path to project directory.
  let projectPath: string;

  if (args[0]) {
    projectPath = args[0].trim();
    // If the provided path is not absolute, make it absolute.
    if (!path.isAbsolute(projectPath)) projectPath = path.resolve(projectPath);
    const splitPath = projectPath.split(path.sep);
    projectName = splitPath[splitPath.length - 1]?.trim() || "";

    const nameValidation = await validateProjectName({ projectName });
    if (!nameValidation.valid) throw new ValidationError(nameValidation);

    log(pico.green("√"), pico.bold("Using project name:"), projectName);
  } else {
    const res = await prompts({
      initial: "my-app",
      name: "projectName",
      message: "What's the name of your project?",
      type: "text",
      async validate(projectName) {
        const validation = await validateProjectName({ projectName });
        if (!validation.valid) return validation.message;
        return true;
      },
    });
    projectName = res.projectName?.trim();
    projectPath = path.resolve(projectName);
  }

  // Validate project path
  const pathValidation = await validateProjectPath({ projectPath });
  if (!pathValidation.valid) throw new ValidationError(pathValidation);

  // After validating that the directory does not already exist, create it.
  mkdirSync(projectPath, { recursive: true });

  // Extract template ID from CLI or prompt
  if (!templateId) {
    templateId = (
      await prompts({
        name: "templateId",
        message: "Which template would you like to use?",
        type: "select",
        choices: templates.map(({ id, ...t }) => ({
          ...t,
          value: id,
        })),
      })
    ).templateId;
  }

  // Get template meta
  const templateMeta = templates.find(({ id }) => id === templateId);
  if (!templateMeta) throw new ValidationError(templateValidation);

  // Validate template name
  templateValidation = await validateTemplateName({
    templateId,
    templates,
  });
  if (!templateValidation.valid) throw new ValidationError(templateValidation);

  log();

  // Copy template contents into the target path
  const templatePath = path.join(templatesPath, templateMeta.id);
  await cpy(path.join(templatePath, "**", "*"), projectPath, {
    rename: (name) => name.replace(/^_dot_/, "."),
  });

  // Create package.json for project
  const packageJson = await fs.readJSON(path.join(projectPath, "package.json"));
  packageJson.name = projectName;
  // Only override starknet-ponder version if not already a link (for development)
  if (!packageJson.dependencies["starknet-ponder"]?.startsWith("link:")) {
    packageJson.dependencies["starknet-ponder"] = `^${rootPackageJson.version}`;
  }
  if (!packageJson.devDependencies["eslint-config-ponder"]?.startsWith("link:")) {
    packageJson.devDependencies["eslint-config-ponder"] =
      `^${rootPackageJson.version}`;
  }
  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  const packageManager = getPackageManager({ options });

  // Install in background to not clutter screen
  const installArgs = [
    "install",
    packageManager === "npm" ? "--quiet" : "--silent",
  ];
  if (!options.skipInstall) {
    await oraPromise(
      execa(packageManager, installArgs, {
        cwd: projectPath,
        env: {
          ...process.env,
          ADBLOCK: "1",
          DISABLE_OPENCOLLECTIVE: "1",
          // we set NODE_ENV to development as pnpm skips dev
          // dependencies when production
          NODE_ENV: "development",
        },
      }),
      {
        text: `Installing packages with ${pico.bold(packageManager)}. This may take a few seconds.`,
        failText: "Failed to install packages.",
        successText: `Installed packages with ${pico.bold(packageManager)}.`,
      },
    );
  }

  // Create git repository
  if (!options.skipGit) {
    await oraPromise(
      async () => {
        await execa("git", ["init"], { cwd: projectPath });
        await execa("git", ["add", "."], { cwd: projectPath });
        await execa(
          "git",
          [
            "commit",
            "--no-verify",
            "--message",
            "chore: initial commit from create-starknet-ponder",
          ],
          { cwd: projectPath },
        );
      },
      {
        text: "Initializing git repository.",
        failText: "Failed to initialize git repository.",
        successText: "Initialized git repository.",
      },
    );
  }

  log();
  for (const warning of warnings) {
    log(`${pico.yellow("!")} ${warning}`);
  }

  log();
  log("―――――――――――――――――――――");
  log();
  log(
    `${pico.green("Success!")} Created ${pico.bold(projectName)} at ${pico.green(
      path.resolve(projectPath),
    )}`,
  );
  log();
  log(
    `To start your app, run ${pico.bold(
      pico.cyan(`cd ${path.relative(process.cwd(), projectPath)}`),
    )} and then ${pico.bold(
      pico.cyan(
        `${packageManager}${
          packageManager === "npm" || packageManager === "bun" ? " run" : ""
        } dev`,
      ),
    )}`,
  );
  log();
  log("―――――――――――――――――――――");
  log();
}

(async () => {
  const cli = cac(rootPackageJson.name)
    .version(rootPackageJson.version)
    .usage(`${pico.green("<directory>")} [options]`)
    .option(
      "-t, --template [id]",
      `Use a template. Options: ${templates.map(({ id }) => id).join(", ")}`,
    )
    .option("--npm", "Use npm as your package manager")
    .option("--pnpm", "Use pnpm as your package manager")
    .option("--yarn", "Use yarn as your package manager")
    .option("--skip-git", "Skip initializing a git repository")
    .option("--skip-install", "Skip installing packages")
    .help();

  // Check Nodejs version
  const _nodeVersion = process.version.split(".");
  const nodeVersion = [
    Number(_nodeVersion[0]!.slice(1)),
    Number(_nodeVersion[1]),
    Number(_nodeVersion[2]),
  ];
  if (nodeVersion[0]! < 18 || (nodeVersion[0] === 18 && nodeVersion[1]! < 14))
    throw new Error(
      pico.red(
        `Node version:${process.version} does not meet the >=18.14 requirement`,
      ),
    );

  const { args, options } = cli.parse(process.argv);

  try {
    await run({ args, options });
    log();
    await notifyUpdate({ options });
  } catch (error) {
    log(
      error instanceof ValidationError
        ? error.message
        : pico.red((<Error>error).message),
    );
    log();
    await notifyUpdate({ options });
    process.exit(1);
  }
})();
