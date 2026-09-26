from fastapi import APIRouter

from app.deps import DbDep
from app.schemas import UserProfile

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("/{user_id}", response_model=UserProfile)
def get_profile(user_id: str, db: DbDep) -> UserProfile:
    """The saved profile, or an empty one with the default quick phrases."""
    stored = db.get_profile(user_id)
    return UserProfile.model_validate_json(stored) if stored else UserProfile()


@router.put("/{user_id}", response_model=UserProfile)
def put_profile(user_id: str, profile: UserProfile, db: DbDep) -> UserProfile:
    # Keep it small: this is stored locally and sent to Claude with every request.
    profile = UserProfile(
        name=profile.name.strip()[:80],
        relationships=[x.strip()[:80] for x in profile.relationships if x.strip()][:20],
        interests=[x.strip()[:80] for x in profile.interests if x.strip()][:20],
        common_needs=[x.strip()[:80] for x in profile.common_needs if x.strip()][:20],
        phrases=[x.strip()[:120] for x in profile.phrases if x.strip()][:30],
    )
    db.save_profile(user_id, profile.model_dump_json())
    return profile
