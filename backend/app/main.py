"""HTTP API. Stateless: every request carries the whole Project."""

from datetime import date
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .holidays import holidays_between
from .periods import next_period
from .models import Agreement, Evaluation, Project, PublicHoliday, RepairRequest, SolveResult, ValidateRequest
from .sample import sample_project
from .solver import repair, solve
from .spreadsheet import ImportResult, export_roster, import_roster
from .validator import evaluate

app = FastAPI(title="Shift Scheduler")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])


Lang = Literal["en", "is"]


@app.get("/api/sample")
def get_sample(lang: Lang = "en") -> Project:
    return sample_project(lang)


@app.get("/api/holidays")
def get_holidays(start: date, days: int, agreement: Agreement = "sfv") -> list[PublicHoliday]:
    return holidays_between(start, days, agreement)


@app.post("/api/solve")
async def post_solve(project: Project, lang: Lang = "en") -> SolveResult:
    # CP-SAT blocks for up to `solve_seconds`; keep the event loop free.
    return await run_in_threadpool(solve, project, lang)


@app.post("/api/repair")
async def post_repair(body: RepairRequest, lang: Lang = "en") -> SolveResult:
    return await run_in_threadpool(repair, body.project, body.roster, body.today, body.mode, lang)


@app.post("/api/import/roster")
async def post_import_roster(file: UploadFile = File(...), project: str = Form(...)) -> ImportResult:
    content = await file.read()
    try:
        return import_roster(Project.model_validate_json(project), file.filename or "", content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post("/api/export/roster.xlsx")
def post_export_roster(body: ValidateRequest) -> Response:
    data = export_roster(body.project, body.roster)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="vaktaplan.xlsx"'},
    )


@app.post("/api/next-period")
def post_next_period(body: ValidateRequest) -> Project:
    return next_period(body.project, body.roster)


@app.post("/api/validate")
def post_validate(body: ValidateRequest, lang: Lang = "en") -> Evaluation:
    return evaluate(body.project, body.roster, lang)
