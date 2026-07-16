const { spawn } = require("child_process");

function run(file) {
  const p = spawn("node", [file], {
    stdio: "inherit"
  });

  p.on("exit", (code) => {
    console.log(`${file} exited with code ${code}`);
  });
}

run("rajpom/index.js");
run("titanpom/index.js");
