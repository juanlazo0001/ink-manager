"""
What the parity harness compares, and what it looks at on each screen.

Two lists, deliberately separate:

  SCREENS    one row per comparable surface: where it lives on web, how
             to reach it on mobile, and any setup the screen needs.

  LANDMARKS  the named elements whose computed values get tabulated.
             These are TEXT-ADDRESSED, not selector-addressed, and that
             is the load-bearing choice in this file — see below.

─── WHY LANDMARKS ARE FOUND BY TEXT ────────────────────────────────────

Web is real DOM with real class names. The mobile harness is
react-native-web, which emits generated atomic classes (`css-146c3p1`)
that change whenever a style does. A CSS selector that works on both
sides does not exist, and a selector that works on one side today breaks
on the next style edit.

Text is the one addressable thing both sides genuinely share — if the two
clients do not render the same words, that is itself the drift the
harness exists to find, and it shows up as MISSING rather than as a
silently wrong measurement.

`role` narrows the search where a word appears more than once (a heading
"Clients" and a nav link "Clients").
"""

# Viewports. Web gets two: some portal layouts only exist wide, and
# comparing a desktop table against a phone list would report drift that
# is really just responsive design doing its job.
MOBILE_VIEWPORT = (390, 844)
DESKTOP_VIEWPORT = (1440, 900)


class Screen:
    def __init__(self, key, title, web_path, mobile_screen, mobile_params=None, note=None):
        self.key = key
        self.title = title
        #: Path on apps/web, after login. None when the portal has no
        #: comparable route — the chat panel, for instance — in which case
        #: the run captures mobile only and says so.
        self.web_path = web_path
        #: The module the preview route mounts. See tools/parity/README.md.
        self.mobile_screen = mobile_screen
        #: Extra query params the mobile screen needs (an id, usually).
        self.mobile_params = mobile_params or {}
        #: Anything a reader of the report needs to know about this row.
        self.note = note


SCREENS = [
    # Mobile screen keys are the module the preview route mounts, and they
    # are the FILE names, not the tab labels — `(tabs)/index.tsx` is the
    # conversation list, `(tabs)/home.tsx` is the dashboard. Checked
    # against the router rather than assumed.
    Screen("dashboard", "Dashboard", "/dashboard", "home"),
    Screen("inquiries", "Pipeline", "/inquiries", "inquiries"),
    Screen(
        "inquiry-detail",
        "Inquiry detail",
        "/inquiries/{inquiryId}",
        "staff-inquiry",
        {"id": "{inquiryId}"},
    ),
    Screen("clients", "Clients", "/clients", "clients"),
    Screen(
        "client-detail",
        "Client detail",
        "/clients/{clientId}",
        "client",
        {"id": "{clientId}"},
    ),
    Screen(
        "chat-list",
        "Conversations",
        None,
        "chat",
        note="No comparable web route: the portal opens conversations in a docked "
        "panel over whatever page you are on, so there is nothing to navigate to. "
        "Mobile-only capture.",
    ),
    Screen(
        "chat-thread",
        "Chat thread",
        "/conversations/{conversationId}",
        "conversation",
        {"id": "{conversationId}"},
    ),
    Screen("tasks", "Tasks", "/tasks", "tasks"),
    Screen(
        "schedule",
        "Schedule",
        "/calendar",
        "schedule",
        note="Known divergence: month grid on web, day + upcoming on mobile.",
    ),
    Screen("flash", "Flash gallery", "/flash", "flash"),
    Screen("team", "Team", "/team", "team"),
    Screen("settings", "Settings", "/settings", "settings"),
]


class Landmark:
    def __init__(self, name, text, role=None, screens=None):
        self.name = name
        #: Exact, trimmed text content to find.
        self.text = text
        #: ARIA role, when the text alone is ambiguous.
        self.role = role
        #: Restrict to these screen keys; None means "wherever it appears".
        self.screens = screens


# The properties tabulated for every landmark found. Kept short on
# purpose: a table nobody reads is not evidence. These are the ones that
# actually differ when two clients drift.
PROPERTIES = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "color",
    "backgroundColor",
    "paddingTop",
    "paddingLeft",
    "borderRadius",
    "borderTopWidth",
    "borderColor",
    "gap",
]

LANDMARKS = [
    Landmark("page title", "Pipeline", screens=["inquiries"]),
    Landmark("page title", "Clients", role="heading", screens=["clients"]),
    Landmark("page title", "Team", role="heading", screens=["team"]),
    Landmark("page title", "Settings", role="heading", screens=["settings"]),
    Landmark("page title", "Tasks", role="heading", screens=["tasks"]),
    # ─── inquiry detail, session BH ─────────────────────────────────
    # Every section header web renders, plus the type roles the brief
    # names. Text-addressed, so a header that is absent on one side shows
    # up as MISSING rather than as a silently skipped row.
    Landmark("section header", "Progress", screens=["inquiry-detail"]),
    Landmark("section header", "Assignment", screens=["inquiry-detail"]),
    Landmark("section header", "Estimate", screens=["inquiry-detail"]),
    Landmark("section header", "Deposit", screens=["inquiry-detail"]),
    Landmark("section header", "Appointments", screens=["inquiry-detail"]),
    Landmark("section header", "Reference images", screens=["inquiry-detail"]),
    Landmark("section header", "Placement photos", screens=["inquiry-detail"]),
    Landmark("section header", "Inquiry Details", screens=["inquiry-detail"]),
    Landmark("section header", "Notes", screens=["inquiry-detail"]),
    Landmark("section header", "Activity History", screens=["inquiry-detail"]),
    # Field labels and values inside Inquiry Details / "The request".
    Landmark("field label", "Placement", screens=["inquiry-detail"]),
    Landmark("field label", "Budget", screens=["inquiry-detail"]),
    # Header row actions.
    Landmark("header action", "View Client", screens=["inquiry-detail"]),
    Landmark("header action", "Message", screens=["inquiry-detail"]),
    # Pipeline stage labels — content parity, not styling.
    Landmark("stage label", "Needs Scheduling", screens=["inquiry-detail"]),
    Landmark("stage label", "Scheduled", screens=["inquiry-detail"]),
    Landmark("stage label", "Waiver Verified", screens=["inquiry-detail"]),
    Landmark("stage label", "Session Complete", screens=["inquiry-detail"]),
    Landmark("stage label", "Project Complete", screens=["inquiry-detail"]),
    Landmark("section header", "Bio", screens=["team"]),
    Landmark("primary button", "New inquiry", screens=["inquiries"]),
    Landmark("primary button", "Invite team member", screens=["team"]),
    Landmark("tab, selected", "Staff", screens=["team"]),
    Landmark("tab, unselected", "Artists", screens=["team"]),
]


def resolve(template, ids):
    """`/inquiries/{inquiryId}` -> `/inquiries/cms0...`."""
    out = template
    for key, value in ids.items():
        out = out.replace("{" + key + "}", value)
    return out
