import axios from 'axios'
import Chart from 'chart.js'
import 'chartjs-adapter-date-fns'
import 'chartjs-plugin-annotation'
import {
  parseISO,
  differenceInHours,
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

document.addEventListener('DOMContentLoaded', main)

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
  const history = levels.map(({ data: { level, unlocked_at } }) => ({
    x: parseISO(unlocked_at),
    y: level - 1,
  }))
  const forecasts = computeForecasts(history)
  const historyGaps = history.flatMap((item, i) =>
    i > 0 && item.y < history[i - 1].y ? [{}, item] : [item]
  )
  makeChart(historyGaps, forecasts)
}

function computeForecasts(history) {
  let avgHours = [null, null]
  for (let i = 1; i < history.length; ++i) {
    const hours = differenceInHours(history[i].x, history[i - 1].x)
    avgHours.forEach((old, i) => {
      const alpha = ALPHAS[i]
      if (old) avgHours[i] = alpha * hours + (1 - alpha) * old
      else avgHours[i] = hours
    })
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
              max: endOfMonth(minDates([limit, addYears(last, 2)])),
            },
          },
        ],
        yAxes: [
          {
            scaleLabel: {
              display: true,
              labelString: 'Level',
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
          label: 'Started level',
          data: history,
          lineTension: 0,
          backgroundColor: 'rgba(0, 127, 255, 0.5)',
          borderColor: 'rgba(0, 127, 255, 0.5)',
        }),
    },
  })
}
