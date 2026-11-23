// Manages what the library offers, apart from serving it:
//
//   tsx cli.ts import <pack dir>...        import material packs (again: no change)
//   tsx cli.ts releases                    list releases, the current one of each source marked
//   tsx cli.ts rollback <source> <release> make an earlier release current again
//   tsx cli.ts withdraw <id>...            stop offering materials; works keep theirs
//
// The library's data directory is MATERIALS_DATA (default data/materials).
import { Library } from "./library.ts";
import { importPack, releases, rollback } from "./pack.ts";

const [command, ...args] = process.argv.slice(2);
const library = new Library(process.env.MATERIALS_DATA || "data/materials");
try {
  switch (command) {
    case "import":
      if (!args.length) throw Error("用法: import <素材包目录>...");
      for (const dir of args) {
        const started = performance.now();
        const r = importPack(library, dir);
        console.log(
          `${r.source}@${r.release}: ${r.status}, +${r.added} ~${r.updated} =${r.unchanged} -${r.withdrawn}, ${r.files} files, ${Math.round(performance.now() - started)}ms`,
        );
      }
      break;
    case "releases":
      for (const r of releases(library))
        console.log(`${r.active ? "*" : " "} ${r.source}@${r.release}  ${r.materials} materials  ${new Date(r.at).toISOString()}`);
      break;
    case "rollback":
      rollback(library, args[0], args[1]);
      console.log(`${args[0]} 已回到 ${args[1]}`);
      break;
    case "withdraw":
      for (const id of args) library.withdraw(id);
      console.log(`已撤下 ${args.length} 个素材`);
      break;
    default:
      console.log("命令: import | releases | rollback | withdraw");
      process.exitCode = command ? 1 : 0;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  library.close();
}
