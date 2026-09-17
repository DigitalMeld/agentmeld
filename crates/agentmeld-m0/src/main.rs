use agentmeld_m0::{
    protocol::{JsonLines, OllamaTurn, claude_event, codex_event, fixture_tool},
    sandbox::SandboxPlan,
};
use std::{
    io::{self, BufRead, Read, Write},
    path::Path,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("agentmeld-m0: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("supervise") && args.len() == 2 {
        let mut journal = agentmeld_m0::durable::Journal::open(Path::new(&args[1]))?;
        let mut output = io::stdout().lock();
        writeln!(output, "{}", serde_json::json!({"ok": journal.state()}))
            .map_err(|_| "output failed")?;
        output.flush().map_err(|_| "output failed")?;
        let mut input = io::stdin().lock();
        loop {
            let mut line = Vec::new();
            let count = (&mut input)
                .take(65537)
                .read_until(b'\n', &mut line)
                .map_err(|_| "input failed")?;
            if count == 0 {
                break;
            }
            if count > 65536 || !line.ends_with(b"\n") {
                return Err("invalid supervisor frame".into());
            }
            let response = match serde_json::from_slice(&line)
                .map_err(|_| "invalid command".to_string())
                .and_then(|command| journal.apply(command))
            {
                Ok(state) => serde_json::json!({"ok": state}),
                Err(error) => serde_json::json!({"error": error}),
            };
            writeln!(output, "{response}").map_err(|_| "output failed")?;
            output.flush().map_err(|_| "output failed")?;
        }
        return Ok(());
    }
    match args.first().map(String::as_str) {
        Some("sandbox-plan") if args.len() == 4 => {
            let plan = SandboxPlan::new(Path::new(&args[1]), &args[2], &args[3])?;
            println!("{}", serde_json::to_string_pretty(&plan.args()).unwrap());
        }
        Some("replay") if args.len() == 2 && ["codex", "claude", "ollama"].contains(&args[1].as_str()) => {
            let mut decoder = JsonLines::default();
            let mut input = io::stdin().lock();
            let mut buffer = [0; 8192];
            let mut turn = OllamaTurn::default();
            let mut event_count = 0;
            loop {
                let n = input.read(&mut buffer).map_err(|_| "input failed")?;
                if n == 0 { break; }
                for frame in decoder.push(&buffer[..n])? {
                    event_count += 1;
                    if event_count > 4096 { return Err("too many frames".into()); }
                    if args[1] == "ollama" { turn.ingest(&frame)?; }
                    else {
                        let event = if args[1] == "codex" { codex_event(&frame)? } else { claude_event(&frame)? };
                        println!("{}", serde_json::to_string(&event).unwrap());
                    }
                }
            }
            decoder.finish()?;
            if args[1] == "ollama" {
                let (text, calls) = turn.finish()?;
                // Fixture execution only; the production loop/approval broker is not wired here.
                let results = calls.iter().map(fixture_tool).collect::<Result<Vec<_>, _>>()?;
                println!("{}", serde_json::json!({"fixture":true,"text":text,"tool_results":results}));
            }
        }
        _ => return Err("usage: replay <codex|claude|ollama> < fixture.jsonl OR sandbox-plan <root> <name> <image-id> OR supervise <journal>".into()),
    }
    Ok(())
}
