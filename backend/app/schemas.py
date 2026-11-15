"""Contract schemas and normalization rules."""
from datetime import datetime, timezone
from typing import Literal
from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, StrictStr, field_validator, model_validator


class BookingInput(BaseModel):
    slot_id: StrictStr
    name: StrictStr
    email: StrictStr

    @field_validator("slot_id", "name", "email")
    @classmethod
    def nonempty(cls, value: str, info) -> str:
        value = value if info.field_name == "slot_id" else value.strip()
        if not value.strip():
            raise ValueError(f"{info.field_name} must not be empty")
        return value

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        try:
            validate_email(value, check_deliverability=False)
        except EmailNotValidError as exc:
            raise ValueError("invalid email") from exc
        return value.lower()


class SlotInput(BaseModel):
    id: StrictStr
    provider: StrictStr
    start: datetime
    end: datetime

    @field_validator("id", "provider")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("id and provider must not be empty")
        return value

    @field_validator("start", "end", mode="before")
    @classmethod
    def timestamp_string(cls, value):
        if not isinstance(value, str):
            raise ValueError("timestamps must be ISO 8601 strings")
        return value

    @field_validator("start", "end")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("timestamps require a timezone")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def positive_duration(self):
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self


class ResetInput(BaseModel):
    slots: list[SlotInput]

    @model_validator(mode="after")
    def unique_ids(self):
        if len({slot.id for slot in self.slots}) != len(self.slots):
            raise ValueError("slot ids must be unique")
        return self


class BookingOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    slot_id: str
    name: str
    email: str
    status: Literal["confirmed", "cancelled"]
    created_at: datetime


class SlotOutput(BaseModel):
    id: str
    provider: str
    start: datetime
    end: datetime
    available: bool


class SlotList(BaseModel):
    slots: list[SlotOutput]


class BookingPage(BaseModel):
    bookings: list[BookingOutput]
    next_cursor: str | None
