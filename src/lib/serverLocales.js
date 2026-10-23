// Every language's phrases for the server, which sends push notifications
// in each subscriber's language (src/lib/push.js). The app itself loads
// only the one it needs (src/lib/i18nLoad.js).
import ar from '../locales/ar.json' with { type: 'json' };
import de from '../locales/de.json' with { type: 'json' };
import es from '../locales/es.json' with { type: 'json' };
import fr from '../locales/fr.json' with { type: 'json' };
import hi from '../locales/hi.json' with { type: 'json' };
import id from '../locales/id.json' with { type: 'json' };
import it from '../locales/it.json' with { type: 'json' };
import ko from '../locales/ko.json' with { type: 'json' };
import nl from '../locales/nl.json' with { type: 'json' };
import pt from '../locales/pt.json' with { type: 'json' };

export const DICTIONARIES = { ar, de, es, fr, hi, id, it, ko, nl, pt };
