Ext.define('iterRecord', {
    extend: 'Ext.data.Model',
    fields: [
        { name: 'Iteration', type: 'string' },
        { name: 'During', type: 'int' },
        { name: 'After', type: 'int' },
        { name: 'Outstanding', type: 'int' },
        { name: 'Total', type: 'float' },
        { name: 'Average', type: 'float' }
    ]
});

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    config: {
        defaultSettings: {
            UseDefects: true,
            UseTestSets: true,
            UseTestCases: true
        }
    },

    items: [
        {
            xtype: 'container',
            id: 'header',
            layout: 'column',
            align: 'center',
            items: [
                {
                    xtype: 'rallydatefield',
                    id: 'StartDate',
                    stateful: true,
                    fieldLabel: 'Start Date',
                    value: Ext.Date.subtract( new Date(), Ext.Date.DAY, 90) // 90 days of previous iterations
                },
                {
                    xtype: 'rallydatefield',
                    fieldLabel: 'End Date',
                    stateful: true,
                    id: 'EndDate',
                    value: new Date()
                }
            ]
        },
        {
            xtype: 'container',
            id: 'body'
        }

    ],

    getSettingsFields: function() {
        return [
            {
                name: 'UseDefects',
                fieldLabel: 'Include Defects',
                xtype: 'rallycheckboxfield'
            },
            {
                name: 'UseTestCases',
                fieldLabel: 'Include TestCases',
                xtype: 'rallycheckboxfield'
            },
            {
                name: 'UseTestSets',
                fieldLabel: 'Include TestSets',
                xtype: 'rallycheckboxfield'
            }

        ];
    },

    iterStore: null,
    iterationOIDs: [],

    _chartRefresh: function()
    {
        Ext.getCmp('CapChart').destroy();
        this.iterationOIDs = [];
        this.iterStore.destroyStore();
        this._startApp(this);
    },

    launch: function() {

        var app = this;

        app.add( {
        });

        Ext.getCmp('StartDate').on( {
            change: this._chartRefresh,
            scope: app
        });

        Ext.getCmp('EndDate').on( {
            change: this._chartRefresh,
            scope: app
        });

        app._startApp(app);
    },

    _startApp: function(app) {

        app.iterStore = Ext.create('Rally.data.wsapi.Store', {
            model: 'Iteration',
            autoLoad: 'true',
            filters: [
                {
                    property: 'StartDate',
                    operator: '>',
                    value: Ext.getCmp('StartDate').getValue()
                },
                {
                    property: 'StartDate',
                    operator: '<',
                    value: Ext.getCmp('EndDate').getValue()
                }
            ],
            sorters: [
                {
                    property: 'StartDate',
                    direction: 'ASC'
                }
            ],
            listeners: {
                load: function(store, data, success) {
//                    _.each(data, function(record) {
//                        app.iterationOIDs.push( {
//                            '_ref': record.get('_ref') } );
//                    });

                    // Now get utilisation entries
                    app._getUtilisation(app, data);
                }
            }
        });




    },

    _getUtilisation: function(app, iterations) {

        // Create a sequence of OR 'ed filters
        var oredFilters = [];

        _.each(iterations, function (iter) {
            oredFilters.push({ property: 'Iteration', value: iter.get('_ref')});
        });

        if (oredFilters.length === 0)
            oredFilters = null;

        var models = ['User Story'];

        if (this.getSetting('UseDefects')){
            models.push('Defect');
        }
        if (this.getSetting('UseTestCases')){
            models.push('Test Case');
        }
        if (this.getSetting('UseTestSets')){
            models.push('Test Set');
        }
        usStore = Ext.create('Rally.data.wsapi.artifact.Store', {
            models: ['User Story', 'Defect','Test Case', 'Test Set'],
            limit: Infinity,
            filters: Rally.data.wsapi.Filter.or(oredFilters),
            autoLoad: 'true',
            listeners: {
                load: function(store, data, success) {
                    var sortedUS = []; 
                    _.each(iterations, function(iter) {
                        sortedUS.push( {
                            'Iteration' : iter,
                            'data'      : _.filter(data,
                            function(record) {
                                if (!record.get('Iteration')) return false;
                                return record.get('Iteration')._ref === iter.get('_ref'); }
                            )
                        });
                    });
                    var summs = [];
                    _.each(sortedUS,
                        function(n) {
                            if (n.data.length){

                                var lIter = n.Iteration.get('_refObjectName') +
                                                ' (' + n.Iteration.get('Project')._refObjectName + ')';
                                var InIter = 0;
                                var AfterIter = 0;
                                var TotalIter = 0;
                                var Never = 0;
                                var iterEndDate = n.Iteration.get('EndDate');
                                _.each(n.data, function(p) {
                                    if ( p.get('AcceptedDate') ) {
                                        if ( p.get('AcceptedDate') <= iterEndDate) {
                                            InIter += p.get('PlanEstimate');
                                        } else {
                                            AfterIter += p.get('PlanEstimate');
                                        }
                                        TotalIter += p.get('PlanEstimate');
                                    }
                                    else {
                                        Never += p.get('PlanEstimate');
                                        TotalIter += p.get('PlanEstimate');
                                    }
                                });
                                summs.push(  {
                                        'Iteration': lIter,
                                        'During': InIter,
                                        'After': AfterIter,
                                        'Outstanding': Never,
                                        'Total': TotalIter,
                                        'Average': 0 });
                            }
                    });

                    //Find the max utilisation for the chart
                    var loadMax = (Math.floor(_.max(_.pluck(summs,'Total'))/50)+1) * 50;

                    //Now do least mean squares of load into load average
                    var results = app._leastSquares(_.pluck(summs, 'Total'), 1, summs.length);
                    for ( i = 0; i < summs.length; i++){
                        summs[i].Average =  results.yintercept + ((i+1) * results.slope);
                    }

                    //Create a local store for the chart to play with
                    var rStore = Ext.create( 'Ext.data.Store', {
                        model: 'iterRecord',
                        data: summs,
                        proxy: 'memory'
                    });

                    var colors = [
                        '#f9a814',
                        '#ee6c19',
                        '#105cab',
                        '#107c1e',
                        '#df1a7b',
                        '#4a1d7e'
                    ];

                    Ext.chart.theme.appTheme = Ext.extend(Ext.chart.theme.Base, {
                            constructor: function(config) {
                                Ext.chart.theme.Base.prototype.constructor.call(this, Ext.apply({
                                    colors: colors
                                }, config));
                            }
                        });

                    Ext.getCmp('body').add({
                        xtype: 'chart',
                        theme: 'appTheme',
                        id: 'CapChart',
                        store: rStore,
                        style: 'background:#fff',
                        animate: true,
                        autoShow: true,
                        height: 600,
                        width: 1024,
                        legend: {
                            position: 'bottom'
                        },
                        axes: [
                            {
                                type: 'Numeric',
                                position: 'left',
                                field: ['During', 'After', 'Outstanding', 'Total', 'Average'],
                                title: 'Velocity',
                                grid: true
                            },
                            {
                                type: 'Category',
                                position: 'bottom',
                                fields: ['Iteration'],
                                title: 'Iteration',
                                label: {
                                    rotate: {
                                        degrees: 90
                                    }
                                }

                            }
                        ],
                        plotOptions: {
                            series: {
                                stacking: 'normal',
                                stack: 0
                            }
                        },

                        series: [
                            {
                                type: 'column',
                                stack: 0,
                                axis: 'left',
                                xField: 'Iteration',
                                yField: ['During', 'After', 'Outstanding'],
                                markerConfig: {
                                    type: 'cross',
                                    size: 3
                                },
                                tips: {
                                    trackMouse: true,
//                                    width: 140,
//                                    height: 28,
                                    renderer: app._tipsRenderer

                                }
                            },
                            {
                                type: 'line',
                                axis: 'left',
                                highlight: true,
                                xField: 'Iteration',
                                yField: 'Average',
                                markerConfig: {
                                    type: 'circle',
                                    size: 3
                                }
                            },
                            {
                                type: 'line',
                                axis: 'left',
                                highlight: true,
                                xField: 'Iteration',
                                yField: 'Total',
                                markerConfig: {
                                    type: 'cross',
                                    size: 3
                                }
                            }

                        ]
                    });

//                    Ext.getCmp('CapChart').on( {
//                        click: function() {
//                            Ext.create('Rally.ui.dialog.ConfirmDialog', {
//                                title: 'Save as JPEG',
//                                message: 'Save chart to file?',
//                                confirmLabel: 'Save',
//                                listeners: {
//                                    confirm: function(){
//                                        Ext.getCmp('CapChart').save({
//                                            type: 'image/jpeg'
//                                        });
//                                    }
//                                }
//                            });
//                        }
//                    });

                }
            },
            fetch: ['AcceptedDate', 'Iteration', 'PlanEstimate']
        });
    },

    _tipsRenderer: function(storeItem, item) {
        this.setTitle(item.yField);
        this.update(item.value[1]);
    },

    _leastSquares: function(todoValues, firstIndex, lastIndex) {
        var n = (lastIndex + 1) - firstIndex;
        var i;
        var sumx = 0.0, sumx2 = 0.0, sumy = 0.0, sumy2 = 0.0, sumxy = 0.0;
        var slope, yintercept;

        //Compute sums of x, x^2, y, y^2, and xy
        for (i = firstIndex; i <= lastIndex; i++) {
            sumx  = sumx  + i;
            sumx2 = sumx2 + i * i;
            sumy  = sumy  + todoValues[i-1];
            sumy2 = sumy2 + todoValues[i-1] * todoValues[i-1];
            sumxy = sumxy + i * todoValues[i-1];
        }
        slope = (n * sumxy - sumx * sumy) / (n * sumx2 - sumx * sumx);
        yintercept = (sumy * sumx2 - sumx * sumxy) / (n * sumx2 - sumx * sumx);

        return {slope: slope, yintercept: yintercept};
    }
});
