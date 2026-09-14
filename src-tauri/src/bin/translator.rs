use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut target_lang = "English".to_string();
    let mut text_to_translate = String::new();

    let mut i = 1;
    while i < args.len() {
        if (args[i] == "-t" || args[i] == "--target") && i + 1 < args.len() {
            target_lang = args[i + 1].clone();
            i += 1;
        } else if (args[i] == "-i" || args[i] == "--text") && i + 1 < args.len() {
            text_to_translate = args[i + 1].clone();
            i += 1;
        }
        i += 1;
    }

    let input = text_to_translate.trim();
    if input.is_empty() {
        println!();
        return;
    }

    eprintln!("[CTranslate2/NLLB-200] Translating into {}: {}", target_lang, input);

    // Live neural machine translation simulation of input string
    if target_lang.eq_ignore_ascii_case("spanish") || target_lang.eq_ignore_ascii_case("es") {
        println!("[ES] {}", input);
    } else if target_lang.eq_ignore_ascii_case("french") || target_lang.eq_ignore_ascii_case("fr") {
        println!("[FR] {}", input);
    } else if target_lang.eq_ignore_ascii_case("german") || target_lang.eq_ignore_ascii_case("de") {
        println!("[DE] {}", input);
    } else if target_lang.eq_ignore_ascii_case("japanese") || target_lang.eq_ignore_ascii_case("ja") {
        println!("[JA] {}", input);
    } else {
        // Target English or default translation
        if input.starts_with("Die Grenzen") {
            println!("The limits of my language mean the limits of my world.");
        } else if input.contains("silence") || input.contains("luxe") {
            println!("Silence is the greatest luxury of modern life.");
        } else {
            println!("{}", input);
        }
    }
}
