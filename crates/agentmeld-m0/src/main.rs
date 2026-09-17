use agentmeld_m0::{
    protocol::{JsonLines, OllamaTurn, claude_event, codex_event, fixture_tool},
    sandbox::SandboxPlan,
};
use std::{
    io::{self, Read},
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
        _ => return Err("usage: replay <codex|claude|ollama> < fixture.jsonl OR sandbox-plan <root> <name> <image-id>".into()),
    }
    Ok(())
}
