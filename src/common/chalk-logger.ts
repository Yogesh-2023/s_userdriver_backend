import chalk from "chalk";

export const logCustomer = (action: string, details?: string | object) => {
  const prefix = chalk.bgGreen.black(" [CUSTOMER] ") + " " + chalk.green("🟢");
  const actionText = chalk.green.bold(` ${action} `);
  const detailText = details
    ? chalk.gray(
        typeof details === "object" ? JSON.stringify(details) : details,
      )
    : "";
  console.log(`${prefix}${actionText} ${detailText}`);
};

export const logDriver = (action: string, details?: string | object) => {
  const prefix = chalk.bgBlue.white(" [DRIVER] ") + " " + chalk.blue("🔵");
  const actionText = chalk.blue.bold(` ${action} `);
  const detailText = details
    ? chalk.gray(
        typeof details === "object" ? JSON.stringify(details) : details,
      )
    : "";
  console.log(`${prefix}${actionText} ${detailText}`);
};

export const logAdmin = (action: string, details?: string | object) => {
  const prefix = chalk.bgMagenta.white(" [ADMIN] ") + " " + chalk.magenta("🟣");
  const actionText = chalk.magenta.bold(` ${action} `);
  const detailText = details
    ? chalk.gray(
        typeof details === "object" ? JSON.stringify(details) : details,
      )
    : "";
  console.log(`${prefix}${actionText} ${detailText}`);
};

export const logSystem = (action: string, details?: string | object) => {
  const prefix = chalk.bgCyan.black(" [SYSTEM] ") + " " + chalk.cyan("🌐");
  const actionText = chalk.cyan.bold(` ${action} `);
  const detailText = details
    ? chalk.gray(
        typeof details === "object" ? JSON.stringify(details) : details,
      )
    : "";
  console.log(`${prefix}${actionText} ${detailText}`);
};
