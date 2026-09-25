//! Application OVH embarquée dans le binaire.
//!
//! Les deux valeurs sont injectées à la compilation, pas écrites dans le dépôt :
//!
//! ```bash
//! OVH_APPLICATION_KEY=xxx OVH_APPLICATION_SECRET=yyy npm run app:build
//! ```
//!
//! Elles finissent bien en dur dans le binaire — c'est le choix assumé ici, pour
//! que l'utilisateur n'ait rien à créer lui-même. Conséquence à connaître : un
//! secret présent dans un binaire distribué est extractible. Le garde-fou n'est
//! donc pas le secret, c'est la consumer key, qui reste propre à chaque
//! utilisateur et révocable individuellement depuis son compte OVH.
//!
//! Sans ces variables à la compilation, l'app fonctionne quand même : l'utilisateur
//! fournit sa propre application via `ovh_set_application`.

pub const APPLICATION_KEY: Option<&str> = option_env!("OVH_APPLICATION_KEY");
pub const APPLICATION_SECRET: Option<&str> = option_env!("OVH_APPLICATION_SECRET");

/// L'application embarquée, si elle a été fournie à la compilation.
pub fn embedded() -> Option<(&'static str, &'static str)> {
    match (APPLICATION_KEY, APPLICATION_SECRET) {
        (Some(k), Some(s)) if !k.is_empty() && !s.is_empty() => Some((k, s)),
        _ => None,
    }
}
