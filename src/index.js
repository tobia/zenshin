import axios from 'axios'
import Chart from 'chart.js'
import 'chartjs-adapter-date-fns'
import 'chartjs-plugin-annotation'
import { saveAs } from 'file-saver'
import {
  parseISO,
  differenceInHours,
  differenceInMonths,
  addHours,
  startOfMonth,
  endOfMonth,
  addYears,
  min as minDates,
  max as maxDates,
} from 'date-fns'

const DEVELOPMENT = process.env.NODE_ENV === 'development'

const ALPHAS = [0.5, 0.25]
const MAX_LEVEL = 60
const MAX_YEARS_FORECAST = 3
const GAP_MONTHS = 6
const SKIP_MONTHS = 3

document.addEventListener('DOMContentLoaded', main)

Chart.pluginService.register({
  beforeDraw: function (chart, easing) {
    const ctx = chart.chart.ctx
    ctx.save()
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, chart.canvas.width, chart.canvas.height)
    ctx.restore()
  },
})

async function main() {
  document.getElementById('submitKey').addEventListener('submit', submitKey)
  const apiKey = localStorage.getItem('api-key')
  if (apiKey) {
    document.getElementById('key').value = apiKey
    const data = await fetchData(apiKey)
    processData(data)
  }
}

async function submitKey(event) {
  event.preventDefault()
  const apiKey = document.getElementById('key').value
  const data = await fetchData(apiKey)
  if (!data) return
  localStorage.setItem('api-key', apiKey)
  processData(data)
}

function download() {
  document.getElementById('chart').toBlob((blob) => {
    saveAs(blob, 'zenshin.png')
  })
}

async function fetchData(apiKey) {
  if (DEVELOPMENT) {
    const cached = localStorage.getItem('cached-data')
    if (cached) return JSON.parse(cached)
  }
  const resp = await axios({
    url: 'level_progressions',
    baseURL: 'https://api.wanikani.com/v2/',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (DEVELOPMENT) {
    localStorage.setItem('cached-data', JSON.stringify(resp.data))
  }
  return resp.data
}

async function processData(data) {
  const { data: levels } = data
  let history = levels.map(({ data: { level, unlocked_at } }) => ({
    x: parseISO(unlocked_at),
    y: level - 1,
  }))
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
  makeChart(history, forecasts)
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

function makeChart(history, forecasts) {
  const begin = history[0].x
  const last = history[history.length - 1].x
  const limit = maxDates(forecasts.map((fc) => fc[1].x))
  new Chart('chart', {
    type: 'line',
    options: {
      scales: {
        xAxes: [
          {
            type: 'time',
            ticks: {
              maxRotation: 0,
              autoSkipPadding: 20,
              min: startOfMonth(begin),
              max: endOfMonth(
                minDates([limit, addYears(last, MAX_YEARS_FORECAST)])
              ),
            },
          },
        ],
        yAxes: [
          {
            scaleLabel: {
              display: true,
              labelString: 'Level completed',
              fontSize: 14,
            },
            ticks: {
              min: 0,
              max: 60,
            },
          },
        ],
      },
      annotation: {
        annotations: [
          {
            type: 'line',
            mode: 'vertical',
            scaleID: 'x-axis-0',
            value: new Date(),
            borderColor: 'red',
            borderWidth: 1,
          },
        ],
      },
      legend: {
        display: false,
      },
      layout: {
        padding: {
          top: 40,
          left: 20,
          right: 40,
          bottom: 20,
        },
      },
    },
    data: {
      datasets: forecasts
        .map((data) => ({
          label: '(forecast)',
          data,
          backgroundColor: 'rgba(0, 0, 0, 0.0667)',
          pointRadius: 0,
          pointHitRadius: 0,
          borderWidth: 2,
          borderColor: 'rgba(0, 0, 0, 0.25)',
          borderDash: [10, 10],
          lineTension: 0,
        }))
        .concat({
          label: 'Level completed',
          data: history,
          lineTension: 0,
          backgroundColor: 'rgba(0, 127, 255, 0.5)',
          borderColor: 'rgba(0, 127, 255, 0.5)',
        }),
    },
  })
  const dlButton = document.getElementById('download')
  dlButton.style.display = 'inline'
  dlButton.addEventListener('click', download)
}
