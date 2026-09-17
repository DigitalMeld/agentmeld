use agentmeld_m0::{channel::*, control::*, protocol::*, sandbox::SandboxPlan};
use serde_json::json;

fn scope() -> Scope {
    Scope {
        workspace: "w1".into(),
        actor: "owner".into(),
        run: "run1".into(),
        policy_revision: 1,
        credential_revision: 1,
    }
}
fn action() -> Action {
    Action {
        tool: "send".into(),
        target: "fixture@example.test".into(),
        arguments: json!({"body":"draft"}),
    }
}

#[test]
fn approval_binds_scope_action_expiry_and_is_consumed_once() {
    let mut run = RunControl::new(scope());
    run.propose(&action(), 100).unwrap();
    assert_eq!(run.check_dispatch(0), Err(ControlError::NotRunning));
    let mut wrong = scope();
    wrong.actor = "guest".into();
    assert_eq!(
        run.decide(&wrong, &action(), 1, true),
        Err(ControlError::WrongScope)
    );
    wrong = scope();
    wrong.credential_revision += 1;
    assert_eq!(
        run.decide(&wrong, &action(), 1, true),
        Err(ControlError::WrongScope)
    );
    let mut changed = action();
    changed.arguments = json!({"body":"different"});
    assert_eq!(
        run.decide(&scope(), &changed, 1, true),
        Err(ControlError::ChangedAction)
    );
    assert_eq!(
        run.decide(&scope(), &action(), 2, true).unwrap(),
        Some(action())
    );
    assert_eq!(
        run.decide(&scope(), &action(), 2, true),
        Err(ControlError::NoPendingApproval)
    );
    run.propose(&action(), 100).unwrap();
    assert_eq!(
        run.decide(&scope(), &action(), 100, true),
        Err(ControlError::Expired)
    );
    assert_eq!(
        run.decide(&scope(), &action(), 99, true),
        Err(ControlError::NoPendingApproval)
    );
}

#[test]
fn deny_cancel_takeover_and_stale_controller_never_dispatch() {
    let mut run = RunControl::new(scope());
    run.propose(&action(), 100).unwrap();
    assert_eq!(run.decide(&scope(), &action(), 1, false).unwrap(), None);
    run.propose(&action(), 100).unwrap();
    let lease = run.take_control().unwrap();
    assert_eq!(run.check_dispatch(0), Err(ControlError::StaleLease));
    assert_eq!(run.check_dispatch(lease), Err(ControlError::NotRunning));
    assert_eq!(
        run.decide(&scope(), &action(), 1, true),
        Err(ControlError::NoPendingApproval)
    );
    run.resume(lease).unwrap();
    assert_eq!(run.check_dispatch(lease), Err(ControlError::StaleLease));
    run.cancel();
    assert!(run.resume(run.generation()).is_err());
    assert!(run.propose(&action(), 100).is_err());
    assert!(run.complete().is_err());
}

#[test]
fn completed_is_terminal() {
    let mut run = RunControl::new(scope());
    run.complete().unwrap();
    run.cancel();
    assert_eq!(run.state(), State::Completed);
    assert!(run.take_control().is_err());
}

#[test]
fn fragmented_utf8_crlf_and_multiple_frames_decode() {
    let data = "{\"text\":\"héllo\"}\r\n\n{\"done\":true}\n".as_bytes();
    let mut decoder = JsonLines::default();
    let mut frames = vec![];
    for byte in data {
        frames.extend(decoder.push(&[*byte]).unwrap());
    }
    decoder.finish().unwrap();
    assert_eq!(frames, vec![json!({"text":"héllo"}), json!({"done":true})]);
}

#[test]
fn malformed_oversized_and_truncated_streams_fail_closed() {
    for bytes in [b"{invalid}\n".to_vec(), vec![b'x'; MAX_FRAME + 1]] {
        let mut decoder = JsonLines::default();
        assert!(decoder.push(&bytes).is_err());
        assert!(decoder.push(b"{}\n").is_err());
    }
    let mut decoder = JsonLines::default();
    decoder.push(b"{}").unwrap();
    assert!(decoder.finish().is_err());
}

#[test]
fn codex_requests_and_terminal_errors_are_not_success() {
    assert!(matches!(
        codex_event(&json!({"method":"item/commandExecution/requestApproval","id":7})).unwrap(),
        Event::Approval { .. }
    ));
    assert!(codex_event(&json!({"method":"unknown/approval","id":7})).is_err());
    assert!(codex_event(&json!({"method":"item/fileChange/requestApproval"})).is_err());
    assert!(matches!(
        codex_event(&json!({"method":"turn/completed","params":{"turn":{"status":"failed"}}}))
            .unwrap(),
        Event::Failed { .. }
    ));
    assert!(
        codex_event(&json!({"method":"turn/completed","params":{"turn":{"status":"new-status"}}}))
            .is_err()
    );
}

#[test]
fn claude_partial_text_does_not_establish_completion() {
    assert_eq!(claude_event(&json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}})).unwrap(), Event::Text { text: "hi".into() });
    assert_eq!(
        claude_event(&json!({"type":"result","subtype":"success","is_error":false})).unwrap(),
        Event::Completed
    );
    assert!(matches!(
        claude_event(&json!({"type":"result","subtype":"error_max_turns","is_error":true}))
            .unwrap(),
        Event::Failed { .. }
    ));
    assert!(matches!(
        claude_event(&json!({"type":"result","subtype":"success"})).unwrap(),
        Event::Failed { .. }
    ));
}

#[test]
fn ollama_waits_for_terminal_frame_before_tools_are_available() {
    let partial = json!({"message":{"content":"","tool_calls":[{"function":{"name":"sum","arguments":{"a":2,"b":3}}}]},"done":false});
    let mut turn = OllamaTurn::default();
    turn.ingest(&partial).unwrap();
    assert!(turn.finish().is_err());
    let mut turn = OllamaTurn::default();
    turn.ingest(&partial).unwrap();
    turn.ingest(&json!({"done":true})).unwrap();
    let (_, calls) = turn.finish().unwrap();
    assert_eq!(fixture_tool(&calls[0]).unwrap(), json!({"sum":5}));
}

#[test]
fn ollama_errors_and_malformed_arguments_poison_the_turn() {
    let mut turn = OllamaTurn::default();
    assert!(turn.ingest(&json!({"done":false,"message":{"tool_calls":[{"function":{"name":"sum","arguments":"partial"}}]}})).is_err());
    assert!(turn.ingest(&json!({"done":true})).is_err());
    assert!(turn.finish().is_err());
    let mut turn = OllamaTurn::default();
    assert!(turn.ingest(&json!({"error":"fixture failure"})).is_err());
    assert!(turn.finish().is_err());
}

#[test]
fn fixture_tools_reject_ungranted_names_extra_fields_and_overflow() {
    for call in [
        ToolCall {
            name: "shell".into(),
            arguments: json!({}),
        },
        ToolCall {
            name: "sum".into(),
            arguments: json!({"a":1,"b":2,"cmd":"whoami"}),
        },
        ToolCall {
            name: "sum".into(),
            arguments: json!({"a":i64::MAX,"b":1}),
        },
    ] {
        assert!(fixture_tool(&call).is_err());
    }
}

fn binding() -> Binding {
    Binding {
        bridge: "b1".into(),
        account: "agent@example.test".into(),
        chat: "chat1".into(),
        sender: "owner@example.test".into(),
        actor: "owner".into(),
    }
}
fn inbound() -> Inbound {
    Inbound {
        bridge: "b1".into(),
        account: "agent@example.test".into(),
        chat: "chat1".into(),
        sender: "owner@example.test".into(),
        service: "iMessage".into(),
        guid: "m1".into(),
        from_me: false,
        is_group: false,
        text: "run the fixture".into(),
    }
}

#[test]
fn imessage_identity_echo_deduplication_and_revocation() {
    let mut gate = ChannelGate::new(binding());
    let mut wrong = inbound();
    wrong.sender = "guest@example.test".into();
    assert!(gate.accept(wrong).is_err());
    let mut echo = inbound();
    echo.from_me = true;
    assert_eq!(gate.accept(echo).unwrap(), Disposition::Echo);
    assert!(matches!(
        gate.accept(inbound()).unwrap(),
        Disposition::Accepted { .. }
    ));
    assert_eq!(gate.accept(inbound()).unwrap(), Disposition::Duplicate);
    gate.revoke();
    assert!(gate.accept(inbound()).is_err());
}

#[test]
fn imessage_does_not_accept_other_chat_group_or_sms() {
    let mut gate = ChannelGate::new(binding());
    let mut wrong = inbound();
    wrong.chat = "another-chat".into();
    assert!(gate.accept(wrong).is_err());
    let mut wrong = inbound();
    wrong.is_group = true;
    assert!(gate.accept(wrong).is_err());
    let mut wrong = inbound();
    wrong.service = "SMS".into();
    assert!(gate.accept(wrong).is_err());
    let mut wrong = inbound();
    wrong.guid.clear();
    assert!(gate.accept(wrong).is_err());
}

#[test]
fn sandbox_plan_requires_owned_directory_and_immutable_image() {
    let root = std::env::temp_dir().join(format!("agentmeld-test-{}", std::process::id()));
    std::fs::create_dir_all(root.join("fixture")).unwrap();
    let image = format!("sha256:{}", "a".repeat(64));
    let args = SandboxPlan::new(&root, "fixture", &image).unwrap().args();
    assert!(args.contains(&"--network=none".into()));
    assert!(args.contains(&"--read-only".into()));
    assert!(args.contains(&"--cap-drop=ALL".into()));
    assert_eq!(args.iter().filter(|a| a.as_str() == "--mount").count(), 1);
    assert!(
        !args
            .iter()
            .any(|a| a.contains("docker.sock") || a.contains("privileged"))
    );
    assert!(SandboxPlan::new(&root, "../escape", &image).is_err());
    assert!(SandboxPlan::new(&root, "fixture", "node:latest").is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(std::env::temp_dir(), root.join("symlink")).unwrap();
        assert!(SandboxPlan::new(&root, "symlink", &image).is_err());
        std::fs::remove_file(root.join("symlink")).unwrap();
    }
    std::fs::remove_dir(root.join("fixture")).unwrap();
    std::fs::remove_dir(root).unwrap();
}
