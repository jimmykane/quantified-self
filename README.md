[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/#https://github.com/jimmykane/quantified-self)
![Testing](https://github.com/jimmykane/quantified-self/workflows/Testing/badge.svg)

Quantified Self
==============


About
-----

Quantified Self is a tool for importing viewing and comparing tcx, fit and json files from activity trackers
and smart-watches such as Garmin, Suunto, Polar etc

All is build on Firebase with Angular, Angular Material and as tries to achieve realtime dashboards and activity analysis via the Firebase Firestore

Currently there is Suunto app sync and history support via cloud functions

You can see it in action at [quantified-self.io](https://www.quantified-self.io/)

This project uses [Quantified Self Lib](https://github.com/jimmykane/quantified-self-lib) under the hood for processing the gpx, tcx and fit files


Contribution and assistance is very much welcome

How to run this project (incomplete)
-----------------------

- Clone this project

  `git clone https://github.com/jimmykane/quantified-self.git`
  
- Install the dependencies 

  `yarn install`
  
- Start the Angular Server
  
  `yarn start`
  
- Open it on your browser
 
  `http://localhost:4200/`
  



Data Retention & TTL
-----------------

To ensure data hygiene and compliance, the following Firestore Time-To-Live (TTL) policies are in place:

| Collection | TTL Duration                   | Field      | Description |
|------------|--------------------------------|------------|-------------|
| `mail`     | 3 months (approx 90 days)      | `expireAt` | Transactional emails (Trigger Email extension) |
| `failed_jobs` | 7 days | `expireAt` | Failed job logs |
| `*Queue`   | 7 days | `expireAt` | Queue items for processing |

Attributions

- Icons: "Alessandro"
