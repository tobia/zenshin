'use strict'

import axios from 'axios'
import {
  Chart,
  LineController,
  Filler,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
} from 'chart.js'
import 'chartjs-adapter-date-fns'
import AnnotationPlugin from 'chartjs-plugin-annotation'
import { saveAs } from 'file-saver'
import {
  parseISO,
  differenceInHours,
  differenceInDays,
  differenceInMonths,
  addHours,
  startOfMonth,
  endOfMonth,
  addYears,
  min as minDates,
  max as maxDates,
} from 'date-fns'

Chart.register(
  LineController,
  Filler,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  AnnotationPlugin,
)

const DEVELOPMENT = process.env.NODE_ENV === 'development'

const ALPHAS = [0.5, 0.25]
const MAX_LEVEL = 60
const MAX_YEARS_FORECAST = 3
const GAP_MONTHS = 6
const SKIP_MONTHS = 3

document.addEventListener('DOMContentLoaded', main)

let data
let chart

async function main() {
  const submitForm = document.getElementById('submitForm')
  const startDate = document.getElementById('startDate')
  submitForm.addEventListener('submit', submitKey)
  startDate.addEventListener('change', changeStart)
  startDate.value = localStorage.getItem('start-date')
  let apiKey = localStorage.getItem('api-key')
  if (apiKey) {
    apiKey = apiKey.replace(/[^\w-]/g, '') // weird bug, some users have spaces?
    document.getElementById('key').value = apiKey
    data = await fetchData(apiKey)
    if (!data) return
    processData()
  }
}

function changeStart(event) {
  const startDateStr = document.getElementById('startDate').value
  localStorage.setItem('start-date', startDateStr)
  if (data) processData()
}

async function submitKey(event) {
  event.preventDefault()
  const apiKey = document.getElementById('key').value
  data = await fetchData(apiKey)
  if (!data) return
  localStorage.setItem('api-key', apiKey)
  processData()
}

function download() {
  document.getElementById('chart').toBlob((blob) => {
    saveAs(blob, 'zenshin.png')
  })
}

async function fetchData(apiKey) {
  // if development, use cached data
  if (DEVELOPMENT) {
    const cached = localStorage.getItem('cached-data')
    if (cached) return JSON.parse(cached)
  }

  // fetch level progressions
  const levels_resp = await axios({
    url: 'https://api.wanikani.com/v2/level_progressions',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const levels = levels_resp.data.data

  // fetch burned
  const burned = []
  let burned_url = 'https://api.wanikani.com/v2/assignments?burned=true'
  while (burned_url) {
    const burned_resp = await axios({
      url: burned_url,
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    burned.push(...burned_resp.data.map((it) => parseISO(it.data.burned_at)))
    burned_url = burned_resp.pages.next_url
  }
  burned.sort()

  // full data
  const data = { levels, burned }

  // if development, save data to cache
  if (DEVELOPMENT) {
    localStorage.setItem('cached-data', JSON.stringify(data))
  }
  return data
}

async function processData() {
  const { levels } = data
  let history = levels.map(({ data: { level, unlocked_at } }) => ({
    x: parseISO(unlocked_at),
    y: level - 1,
  }))
  const startDateStr = document.getElementById('startDate').value
  const startDate = startDateStr
    ? maxDates([parseISO(startDateStr), history[0].x])
    : history[0].x
  history = history.filter(({ x }) => x >= startDate)
  const { data: last } = levels[levels.length - 1]
  if (last.passed_at) {
    history.push({
      x: parseISO(last.passed_at),
      y: last.level,
    })
  }
  const forecasts = computeForecasts(history)
  // add a gap in the chart whenever a user restarts Wanikani, or when there is
  // a pause longer than GAP_MONTHS months
  history = history.flatMap((item, i) => {
    if (i == 0) return [item]
    const prev = history[i - 1]
    if (item.y < prev.y) return [{}, item]
    if (differenceInMonths(item.x, prev.x) >= GAP_MONTHS) return [{}, item]
    return [item]
  })
  // compute speed
  const speed = history.flatMap((item, i) => {
    if (i == 0) return []
    if (item.x === undefined) return [{}] // propagate history gap into speed gap
    if (item.y < 3) return []
    const prev = history[i - 1]
    if (prev.x === undefined) return [] // skip first node after a gap
    const dx_months = differenceInDays(item.x, prev.x) / 30
    const dy_levels = item.y - prev.y
    const avg_x = avgDate(prev.x, item.x)
    return { x: avg_x, y: dy_levels / dx_months }
  })
  makeChart(history, forecasts, speed)
}

function computeForecasts(history) {
  let avgHours = [null, null]
  for (let i = 1; i < history.length; ++i) {
    const cur = history[i].x
    const prev = history[i - 1].x
    const hours = differenceInHours(cur, prev)
    const months = differenceInMonths(cur, prev)
    if (cur && prev && months < SKIP_MONTHS) {
      avgHours.forEach((old, i) => {
        if (!old) {
          avgHours[i] = hours
        } else {
          const alpha = ALPHAS[i]
          avgHours[i] = alpha * hours + (1 - alpha) * old
        }
      })
    }
  }
  const last = history[history.length - 1]
  const levelsToDo = MAX_LEVEL - last.y
  return avgHours.map((avg) => [
    { x: last.x, y: last.y },
    { x: addHours(last.x, avg * levelsToDo), y: MAX_LEVEL },
  ])
}

function avgDate(a, b) {
  return new Date((a.getTime() + b.getTime()) / 2)
}

function makeChart(history, forecasts, speed) {
  const begin = history[0].x
  const last = history[history.length - 1].x
  const limit = maxDates(forecasts.map((fc) => fc[1].x))
  if (chart) chart.destroy()
  chart = new Chart('chart', {
    type: 'line',
    options: {
      scales: {
        x: {
          type: 'time',
          ticks: {
            maxRotation: 0,
            autoSkipPadding: 20,
            min: startOfMonth(begin),
            max: endOfMonth(
              minDates([limit, addYears(last, MAX_YEARS_FORECAST)]),
            ),
          },
        },
        level: {
          position: 'left',
          title: {
            display: true,
            text: 'Level completed',
            color: 'rgb(0, 127, 255)',
            font: {
              size: 14,
              weight: 'bold',
            },
          },
          min: 0,
          max: 60,
          ticks: {
            count: 7,
          },
        },
        speed: {
          position: 'right',
          grace: '50%',
          title: {
            display: true,
            text: 'Speed (levels per month)',
            color: 'rgb(223, 0, 0)',
            font: {
              size: 14,
              weight: 'bold',
            },
          },
          min: 0,
          max: 6,
          ticks: {
            count: 7,
          },
          grid: {
            drawOnChartArea: false,
          },
        },
      },
      layout: {
        padding: {
          top: 40,
          left: 20,
          right: 40,
          bottom: 20,
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        annotation: {
          annotations: [
            {
              type: 'line',
              xMin: new Date(),
              xMax: new Date(),
              borderColor: 'rgba(223, 0, 0, 0.5)',
              borderWidth: 2,
            },
          ],
        },
      },
    },
    plugins: [
      {
        beforeDraw(chart) {
          const ctx = chart.canvas.getContext('2d')
          ctx.save()
          ctx.globalCompositeOperation = 'destination-over'
          ctx.fillStyle = 'white'
          ctx.fillRect(0, 0, chart.width, chart.height)
          ctx.restore()
        },
      },
    ],
    data: {
      datasets: forecasts
        .map((data) => ({
          label: '(forecast)',
          data,
          yAxisID: 'level',
          pointRadius: 0,
          pointHitRadius: 0,
          borderWidth: 2,
          borderColor: 'rgba(0, 0, 0, 0.2)',
          borderDash: [10, 10],
          lineTension: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.0333)',
          fill: 'start',
        }))
        .concat(
          {
            label: 'Speed',
            data: speed,
            yAxisID: 'speed',
            lineTension: 0.4,
            pointRadius: 0,
            pointHitRadius: 0,
            backgroundColor: 'transparent',
            borderColor: 'rgba(223, 0, 0, 0.5)',
            borderWidth: 2,
          },
          {
            label: 'Level completed',
            data: history,
            yAxisID: 'level',
            lineTension: 0,
            borderColor: 'rgba(0, 127, 255, 0.5)',
            backgroundColor: 'rgba(0, 127, 255, 0.5)',
            fill: 'start',
          },
        ),
    },
  })
  document.getElementById('bottom').style.display = 'block'
  document.getElementById('download').addEventListener('click', download)
}
