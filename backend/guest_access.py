"""Guest public-access policy helpers.

Default is require admin approval (current desk behaviour). When the flag is
off, a full name is still stored and a guest session is minted immediately.
"""


def require_approval_flag(settings_doc) -> bool:
    """True unless admin explicitly turned the queue off."""
    if not isinstance(settings_doc, dict):
        return True
    if "require_approval" not in settings_doc:
        return True
    return bool(settings_doc.get("require_approval"))
