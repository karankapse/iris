from pydantic import BaseModel, Field


class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    name: str = Field(min_length=1, max_length=80, description="The person who will use Iris")


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str


class AuthResponse(BaseModel):
    token: str = Field(description="Send as 'Authorization: Bearer <token>'")
    user: UserOut


class UpdateMeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=200)


class DeleteAccountRequest(BaseModel):
    password: str = Field(description="Confirms it's really the account owner")


class SignupResponse(BaseModel):
    email: str
    needs_verification: bool = Field(
        default=True, description="A confirmation link was emailed; sign-in works after clicking it"
    )


class TokenRequest(BaseModel):
    token: str


class EmailRequest(BaseModel):
    email: str


class EyeCalibration(BaseModel):
    """This person's eye calibration, as saved by the browser (storage key -> JSON text).
    Kept with the account so it follows them to any computer."""

    data: dict[str, str] | None = Field(
        default=None, description="None = this account hasn't calibrated its eyes yet"
    )
